import type { ModelDelta } from "@repo/interpreter/session";

export type StreamedDelta = ModelDelta | { readonly failure: string };

export const MODEL_ROUTE = "/model";

const encoder = new TextEncoder();

export function encodeDelta(delta: StreamedDelta): Uint8Array {
	return encoder.encode(`${JSON.stringify(delta)}\n`);
}

export async function* readLines(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { done, value } = await reader.read();
		buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		yield* lines;
		if (done) break;
	}
	if (buffer !== "") yield buffer;
}

export async function* decodeDeltas(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<ModelDelta> {
	for await (const line of readLines(body)) {
		if (line === "") continue;
		const delta = JSON.parse(line) as StreamedDelta;
		if ("failure" in delta) throw new Error(delta.failure);
		yield delta;
	}
}

export function endsSentence(text: string): boolean {
	return /[.!?\n]/.test(text);
}
