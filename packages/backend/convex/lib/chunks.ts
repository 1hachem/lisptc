import { REPL_LAYER_CHUNK_CHARS } from "../limits.js";

export function chunked(json: string): string[] {
	const chunks: string[] = [];
	for (let at = 0; at < json.length; at += REPL_LAYER_CHUNK_CHARS)
		chunks.push(json.slice(at, at + REPL_LAYER_CHUNK_CHARS));
	return chunks;
}
