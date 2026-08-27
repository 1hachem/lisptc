// Prime a running llama-server with the lisptc system prompt and persist the
// resulting KV cache to disk (slot save), so a later `restore` skips re-evaluating
// the whole prompt. Requires the server started with `--slot-save-path` and,
// for gemma's sliding-window attention, `--swa-full` (otherwise the prefix KV is
// discarded and can't be reused). See `task serve-gemma` / `task serve-gemma:warm`.
//
// The system prompt is tens of thousands of tokens; evaluating it on CPU takes
// many minutes during which no response bytes flow, which trips `fetch`'s
// (undici) header/body timeouts. So we use `node:http` directly, with all socket
// timeouts disabled.
import { request } from "node:http";
import { LISP_SYSTEM_PROMPT } from "../src/index.ts";

const base = new URL(process.env.LLAMACPP_BASE_URL ?? "http://127.0.0.1:8080/v1");
const slotFile = process.env.LLAMACPP_SLOT_FILE ?? "system.bin";

function post(
	path: string,
	body: unknown,
): Promise<{ status: number; text: string }> {
	const payload = JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = request(
			{
				hostname: base.hostname,
				port: base.port,
				path,
				method: "POST",
				headers: {
					"content-type": "application/json",
					"content-length": Buffer.byteLength(payload),
				},
				timeout: 0, // no idle timeout — prompt eval can run for many minutes
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
		req.write(payload);
		req.end();
	});
}

// Process the system prompt into slot 0's KV. One decoded token is enough — we
// only care about the cached prefix, not the completion.
const warm = await post(`${base.pathname}/chat/completions`.replace("//", "/"), {
	messages: [{ role: "system", content: LISP_SYSTEM_PROMPT }],
	max_tokens: 1,
	stream: false,
	cache_prompt: true,
});
if (warm.status !== 200)
	throw new Error(`warm request failed: ${warm.status} ${warm.text}`);

const save = await post(`/slots/0?action=save`, { filename: slotFile });
if (save.status !== 200)
	throw new Error(`slot save failed: ${save.status} ${save.text}`);

const info = JSON.parse(save.text) as { n_saved?: number };
console.log(
	`saved system-prompt KV (${info.n_saved ?? "?"} tokens) to slot file "${slotFile}"`,
);
