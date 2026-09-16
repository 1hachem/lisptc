// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Scramble } from "./scramble.tsx";

const TEXT = "load-mcp";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

async function shownAfter(ms: number, enabled = true): Promise<string> {
	vi.useFakeTimers();
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(
			<StrictMode>
				<Scramble text={TEXT} enabled={enabled} />
			</StrictMode>,
		);
	});
	await act(async () => {
		vi.advanceTimersByTime(ms);
	});
	const text = host.querySelector("span")?.textContent ?? "";
	await act(async () => {
		root.unmount();
	});
	vi.useRealTimers();
	return text;
}

describe("Scramble", () => {
	it("settles on the text it was given", async () => {
		expect(await shownAfter(4000)).toBe(TEXT);
	});

	it("hands the text over at once when the effect is off", async () => {
		expect(await shownAfter(0, false)).toBe(TEXT);
	});

	it("holds its width from the first frame, so nothing reflows", async () => {
		for (const ms of [0, 50, 120, 300, 700, 4000])
			expect(await shownAfter(ms)).toHaveLength(TEXT.length);
	});

	it("settles left to right, never unsettling what it settled", async () => {
		let settled = 0;
		for (const ms of [0, 90, 180, 270, 360, 450, 720, 4000]) {
			const shown = await shownAfter(ms);
			let at = 0;
			while (at < TEXT.length && shown[at] === TEXT[at]) at += 1;
			expect(at).toBeGreaterThanOrEqual(settled);
			settled = at;
		}
		expect(settled).toBe(TEXT.length);
	});

	it("starts as something other than the text", async () => {
		expect(await shownAfter(0)).not.toBe(TEXT);
	});
});
