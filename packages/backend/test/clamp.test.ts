import { describe, expect, it } from "vitest";
import { clamp } from "../convex/lib/clamp.ts";
import { CONVEX_DOCUMENT_BYTES, MAX_MESSAGE_BYTES } from "../convex/limits.ts";

const encoder = new TextEncoder();

function size(
	content: string,
	additional_kwargs: Record<string, unknown> | undefined,
) {
	return encoder.encode(JSON.stringify({ content, additional_kwargs })).length;
}

describe("clamp", () => {
	it("keeps a message that fits", () => {
		const additional_kwargs = { meta: { durationMs: 12 } };
		expect(clamp("hello", additional_kwargs)).toEqual({
			content: "hello",
			additional_kwargs,
			truncated: false,
		});
	});

	it("holds a truncated message under the document ceiling", () => {
		const clamped = clamp("x".repeat(MAX_MESSAGE_BYTES * 4), {
			ui: "y".repeat(MAX_MESSAGE_BYTES * 4),
			meta: { durationMs: 12 },
		});
		expect(clamped.truncated).toBe(true);
		expect(size(clamped.content, clamped.additional_kwargs)).toBeLessThan(
			MAX_MESSAGE_BYTES,
		);
		expect(MAX_MESSAGE_BYTES).toBeLessThan(CONVEX_DOCUMENT_BYTES);
	});

	it("drops the oversized annotation and keeps the small one", () => {
		const clamped = clamp("x".repeat(MAX_MESSAGE_BYTES * 4), {
			ui: "y".repeat(MAX_MESSAGE_BYTES * 4),
			meta: { durationMs: 12 },
		});
		expect(clamped.additional_kwargs).toEqual({ meta: { durationMs: 12 } });
	});

	it("never splits a multi-byte character", () => {
		const clamped = clamp("é".repeat(MAX_MESSAGE_BYTES), undefined);
		expect(clamped.truncated).toBe(true);
		expect(clamped.content.includes("�")).toBe(false);
	});
});
