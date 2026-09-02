// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Typewriter } from "./typewriter.tsx";

/*
 * Everything here is rendered under `StrictMode`, and that is the point.
 *
 * Strict Mode tears an effect down and sets it up again on the same instance,
 * which a reveal built on `setInterval` has to survive — a hot reload does the
 * same thing. It didn't: the hook returned early on the second setup and left the
 * text at zero characters with the cursor blinking over nothing, which is exactly
 * how it reached a user.
 */

const TEXT = "morning, sunshine. what are we building?";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

async function reveal(ms: number, enabled = true) {
	vi.useFakeTimers();
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(
			<StrictMode>
				<Typewriter text={TEXT} enabled={enabled} />
			</StrictMode>,
		);
	});
	await act(async () => {
		vi.advanceTimersByTime(ms);
	});
	// the outer span holds the text, the inner one is the block cursor
	const outer = host.querySelector("span");
	const cursor = outer?.querySelector("span");
	const seen = {
		text: outer?.textContent ?? "",
		cursor: Boolean(cursor),
		blinking: cursor?.className.includes("animate-blk") ?? false,
	};
	await act(async () => {
		root.unmount();
	});
	vi.useRealTimers();
	return seen;
}

describe("Typewriter", () => {
	it("reveals the whole text even when the effect is set up twice", async () => {
		expect((await reveal(2000)).text).toBe(TEXT);
	});

	it("leads the text with a solid block, then blinks it", async () => {
		const midway = await reveal(160);
		expect(midway.text.length).toBeGreaterThan(0);
		expect(midway.text.length).toBeLessThan(TEXT.length);
		expect(midway.cursor).toBe(true);
		expect(midway.blinking).toBe(false);

		const finished = await reveal(2000);
		expect(finished.cursor).toBe(true);
		expect(finished.blinking).toBe(true);
	});

	it("shows no block at all when the reveal is off", async () => {
		const off = await reveal(0, false);
		expect(off.text).toBe(TEXT);
		expect(off.cursor).toBe(false);
	});
});
