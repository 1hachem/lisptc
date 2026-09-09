import { createHash } from "node:crypto";
import { readdirSync, unlinkSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { aiEnv } from "@repo/env/ai";
import { providerSpecs } from "@repo/shared/providers";
import { SYSTEM_PROMPT } from "./prompts/lisp.ts";

export type WarmStatus =
	| "pending"
	| "restored"
	| "saved"
	| "unavailable"
	| "failed"
	| "skipped";

const HEALTH_TIMEOUT_MS = 180_000;

const base = new URL(providerSpecs.llamacpp.baseUrl);

export function systemPromptSlotFile(prompt: string = SYSTEM_PROMPT): string {
	const hash = createHash("sha256").update(prompt).digest("hex").slice(0, 12);
	return `system-${hash}.bin`;
}

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

async function waitForHealth(): Promise<boolean> {
	const deadline = Date.now() + HEALTH_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const res = await send("GET", "/health");
			if (res.status === 200) return true;
		} catch {}
		await sleep(1000);
	}
	return false;
}

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
	} catch {}
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
