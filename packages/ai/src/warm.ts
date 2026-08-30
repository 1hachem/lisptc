// Keeps llama-server's slot 0 primed with the lisptc system prompt, so a chat
// request never pays for re-evaluating it (~21.8k chars, minutes on CPU).
//
// The KV is persisted by llama-server itself under `--slot-save-path`, in a file
// named after the prompt's content hash: edit the prompt and the old file is
// simply never asked for, so a stale cache can't be restored. gemma also needs
// `--swa-full`, or its sliding-window attention discards the prefix KV and there
// is nothing reusable to save.
//
// We never stat the cache file — we just ask the server to restore it and let it
// answer. That keeps this working when llama-server isn't on the same host.
import { createHash } from "node:crypto";
import { readdirSync, unlinkSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { aiEnv } from "@repo/env/ai";
import { SYSTEM_PROMPT } from "./prompts/lisp.ts";

export type WarmStatus =
	| "pending"
	| "restored"
	| "saved"
	| "unavailable"
	| "failed";

const DEFAULT_BASE_URL = "http://127.0.0.1:8080/v1";
const HEALTH_TIMEOUT_MS = 180_000;

const base = new URL(aiEnv.LLAMACPP_BASE_URL ?? DEFAULT_BASE_URL);

export function systemPromptSlotFile(prompt: string = SYSTEM_PROMPT): string {
	const hash = createHash("sha256").update(prompt).digest("hex").slice(0, 12);
	return `system-${hash}.bin`;
}

// The system prompt takes many minutes to evaluate, during which no response
// bytes flow — that trips fetch's (undici) header/body timeouts. So: node:http
// with every socket timeout disabled.
function send(
	method: "GET" | "POST",
	path: string,
	body?: unknown,
): Promise<{ status: number; text: string }> {
	const payload = body === undefined ? undefined : JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = request(
			{
				hostname: base.hostname,
				port: base.port,
				path,
				method,
				headers: payload
					? {
							"content-type": "application/json",
							"content-length": Buffer.byteLength(payload),
						}
					: {},
				timeout: 0,
			},
			(res) => {
				let text = "";
				res.setEncoding("utf8");
				res.on("data", (c) => {
					text += c;
				});
				res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
			},
		);
		req.on("error", reject);
		if (payload) req.write(payload);
		req.end();
	});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// `/health` and `/slots` live at the server root; only completions sit under
// the base URL's `/v1` path.
async function waitForHealth(): Promise<boolean> {
	const deadline = Date.now() + HEALTH_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const res = await send("GET", "/health");
			if (res.status === 200) return true;
		} catch {
			// server not listening yet
		}
		await sleep(1000);
	}
	return false;
}

// Each slot file is hundreds of MB, so drop the ones for prompts we no longer
// serve. Best-effort: the directory is a llama-server flag and may not be
// visible from here at all.
function pruneStaleSlots(keep: string): void {
	try {
		const dir = aiEnv.LLAMACPP_SLOT_DIR ?? ".llama-cache";
		for (const name of readdirSync(dir)) {
			if (
				name.startsWith("system-") &&
				name.endsWith(".bin") &&
				name !== keep
			) {
				unlinkSync(join(dir, name));
			}
		}
	} catch {
		// not our filesystem, or nothing to prune
	}
}

async function warm(): Promise<WarmStatus> {
	if (!(await waitForHealth())) {
		console.warn(`no llama-server at ${base.origin} — skipping KV warmup`);
		return "unavailable";
	}

	const slotFile = systemPromptSlotFile();

	const restore = await send("POST", "/slots/0?action=restore", {
		filename: slotFile,
	});
	if (restore.status === 200) {
		console.log(`restored system-prompt KV from ${slotFile}`);
		return "restored";
	}

	console.log(
		`no KV cache for the current prompt — building ${slotFile} (slow)`,
	);
	// One decoded token is enough: we only want the cached prefix, not a completion.
	const completions = `${base.pathname}/chat/completions`.replace("//", "/");
	const evaluated = await send("POST", completions, {
		messages: [{ role: "system", content: SYSTEM_PROMPT }],
		max_tokens: 1,
		stream: false,
		cache_prompt: true,
	});
	if (evaluated.status !== 200) {
		throw new Error(
			`warm request failed: ${evaluated.status} ${evaluated.text}`,
		);
	}

	const save = await send("POST", "/slots/0?action=save", {
		filename: slotFile,
	});
	if (save.status !== 200) {
		throw new Error(`slot save failed: ${save.status} ${save.text}`);
	}

	const { n_saved } = JSON.parse(save.text) as { n_saved?: number };
	console.log(
		`saved system-prompt KV (${n_saved ?? "?"} tokens) to ${slotFile}`,
	);
	pruneStaleSlots(slotFile);
	return "saved";
}

let inFlight: Promise<WarmStatus> | undefined;
let status: WarmStatus = "pending";

/**
 * Prime slot 0 with the system prompt, once per process.
 *
 * Single-flight and memoized: startup kicks it off, and the chat handler awaits
 * the same promise. That gate matters — llama-server runs `--parallel 1`, so a
 * request landing mid-warm would queue ahead of the slot save and get its own
 * conversation persisted as the "system prompt" cache.
 *
 * Never rejects: a cold cache is slow, not broken.
 */
export function ensureWarm(): Promise<WarmStatus> {
	inFlight ??= warm()
		.catch((err) => {
			console.warn(`KV warmup failed: ${err}`);
			return "failed" as const;
		})
		.then((s) => {
			status = s;
			return s;
		});
	return inFlight;
}

export function warmStatus(): WarmStatus {
	return status;
}
