import { asksKey } from "@repo/interpreter/asks";
import { MAX_MESSAGE_BYTES } from "../limits.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CONTENT_SHARE = Math.floor(MAX_MESSAGE_BYTES / 2);

const KEPT_FIRST: ReadonlySet<string> = new Set([asksKey.name]);

function bytes(value: unknown): number {
	const json = JSON.stringify(value);
	return json === undefined ? 0 : encoder.encode(json).length;
}

function truncate(text: string, limit: number): string {
	const encoded = encoder.encode(text);
	if (encoded.length <= limit) return text;
	const head = decoder.decode(encoded.subarray(0, limit));
	return head.endsWith("�") ? head.slice(0, -1) : head;
}

export function clamp(
	content: string,
	kwargs?: Record<string, unknown>,
): {
	content: string;
	kwargs: Record<string, unknown> | undefined;
	truncated: boolean;
} {
	if (bytes(content) + bytes(kwargs) <= MAX_MESSAGE_BYTES) {
		return { content, kwargs, truncated: false };
	}
	const head = truncate(content, CONTENT_SHARE);
	let budget = MAX_MESSAGE_BYTES - bytes(head);
	const kept: Record<string, unknown> = {};
	const entries = Object.entries(kwargs ?? {}).sort(
		([a], [b]) => Number(KEPT_FIRST.has(b)) - Number(KEPT_FIRST.has(a)),
	);
	for (const [key, value] of entries) {
		const cost = bytes(key) + bytes(value);
		if (cost > budget) continue;
		kept[key] = value;
		budget -= cost;
	}
	return {
		content: head,
		kwargs: Object.keys(kept).length === 0 ? undefined : kept,
		truncated: true,
	};
}
