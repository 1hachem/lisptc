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

	it("drops the oversized field and keeps the small one", () => {
		const clamped = clamp("x".repeat(MAX_MESSAGE_BYTES * 4), {
			ui: "y".repeat(MAX_MESSAGE_BYTES * 4),
			meta: { durationMs: 12 },
		});
		expect(clamped.kwargs).toEqual({ meta: { durationMs: 12 } });
	});

	it("keeps an entry's kind and the ask it is held on over a payload that would spend the budget first", () => {
		const clamped = clamp("x".repeat(MAX_MESSAGE_BYTES * 4), {
			value: "y".repeat(Math.floor(MAX_MESSAGE_BYTES / 2) - 64),
			kind: "asks",
			holding: "h1",
		});
		expect(clamped.kwargs).toMatchObject({ kind: "asks", holding: "h1" });
	});

	it("never splits a multi-byte character", () => {
		const clamped = clamp("é".repeat(MAX_MESSAGE_BYTES), undefined);
		expect(clamped.truncated).toBe(true);
		expect(clamped.content.includes("�")).toBe(false);
	});
});
