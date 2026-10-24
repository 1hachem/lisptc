import { describe, expect, it } from "vitest";
import { clamp } from "../convex/lib/clamp.ts";
import { CONVEX_DOCUMENT_BYTES, MAX_MESSAGE_BYTES } from "../convex/limits.ts";

const encoder = new TextEncoder();

function size(content: string, kwargs: Record<string, unknown> | undefined) {
	return encoder.encode(JSON.stringify({ content, kwargs })).length;
}

describe("clamp", () => {
	it("keeps a message that fits", () => {
		const kwargs = { meta: { durationMs: 12 } };
		expect(clamp("hello", kwargs)).toEqual({
			content: "hello",
			kwargs,
			truncated: false,
		});
	});

	it("holds a truncated message under the document ceiling", () => {
		const clamped = clamp("x".repeat(MAX_MESSAGE_BYTES * 4), {
			ui: "y".repeat(MAX_MESSAGE_BYTES * 4),
			meta: { durationMs: 12 },
		});
		expect(clamped.truncated).toBe(true);
		expect(size(clamped.content, clamped.kwargs)).toBeLessThan(
			MAX_MESSAGE_BYTES,
		);
		expect(MAX_MESSAGE_BYTES).toBeLessThan(CONVEX_DOCUMENT_BYTES);
	});

	it("drops the oversized annotation and keeps the small one", () => {
		const clamped = clamp("x".repeat(MAX_MESSAGE_BYTES * 4), {
			ui: "y".repeat(MAX_MESSAGE_BYTES * 4),
			meta: { durationMs: 12 },
		});
		expect(clamped.kwargs).toEqual({ meta: { durationMs: 12 } });
	});

	it("keeps an open ask over a view that would spend the budget first", () => {
		const asks = { open: [{ id: "a1", title: "t", prompt: "p", choices: [] }] };
		const clamped = clamp("x".repeat(MAX_MESSAGE_BYTES * 4), {
			ui: "y".repeat(Math.floor(MAX_MESSAGE_BYTES / 2) - 64),
			asks,
		});
		expect(clamped.kwargs?.asks).toEqual(asks);
	});

	it("never splits a multi-byte character", () => {
		const clamped = clamp("é".repeat(MAX_MESSAGE_BYTES), undefined);
		expect(clamped.truncated).toBe(true);
		expect(clamped.content.includes("�")).toBe(false);
	});
});
