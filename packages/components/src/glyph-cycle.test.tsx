// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GlyphCycle, RUNNING_GLYPHS } from "./glyph-cycle.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = "";
});

async function glyphAfter(ms: number, beatMs?: number): Promise<string | null> {
	vi.useFakeTimers();
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(<GlyphCycle label="connecting" beatMs={beatMs} />);
	});
	await act(async () => {
		vi.advanceTimersByTime(ms);
	});
	return host.querySelector("[data-glyph]")?.getAttribute("data-glyph") ?? null;
}

describe("GlyphCycle", () => {
	it("starts on the first glyph and names itself as a status", async () => {
		expect(await glyphAfter(0)).toBe("0");
		const status = document.querySelector("[role=status]");
		expect(status?.getAttribute("aria-label")).toBe("connecting");
	});

	it("moves one glyph per beat", async () => {
		expect(await glyphAfter(110 * 3)).toBe("3");
	});

	it("wraps around the set", async () => {
		expect(await glyphAfter(110 * RUNNING_GLYPHS.length)).toBe("0");
	});

	it("follows a custom beat", async () => {
		expect(await glyphAfter(500, 250)).toBe("2");
	});
});
