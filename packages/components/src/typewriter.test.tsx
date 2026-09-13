// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type Reveal, Typewriter } from "./typewriter.tsx";

const TEXT = "morning, sunshine. what are we building?";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

async function shownAfter(
	ms: number,
	{ reveal, enabled }: { reveal?: Reveal; enabled?: boolean } = {},
) {
	vi.useFakeTimers();
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(
			<StrictMode>
				<Typewriter text={TEXT} reveal={reveal} enabled={enabled} />
			</StrictMode>,
		);
	});
	await act(async () => {
		vi.advanceTimersByTime(ms);
	});
	const outer = host.querySelector("span");
	const seen = {
		text: outer?.textContent ?? "",
		extra: outer?.querySelector("span") !== null,
	};
	await act(async () => {
		root.unmount();
	});
	vi.useRealTimers();
	return seen;
}

describe("Typewriter", () => {
	it("reveals the whole text even when the effect is set up twice", async () => {
		expect((await shownAfter(4000)).text).toBe(TEXT);
	});

	it("arrives a piece at a time, and draws nothing but the text", async () => {
		const midway = await shownAfter(160);
		expect(midway.text.length).toBeGreaterThan(0);
		expect(midway.text.length).toBeLessThan(TEXT.length);
		expect(midway.extra).toBe(false);
	});

	it("hands over the whole text at once when the reveal is off", async () => {
		expect((await shownAfter(0, { enabled: false })).text).toBe(TEXT);
	});

	it("streams by token without ever leaving a trailing space", async () => {
		for (const ms of [100, 200, 300, 500, 800]) {
			const { text } = await shownAfter(ms, { reveal: "token" });
			expect(text.endsWith(" "), `at ${ms}ms: ${JSON.stringify(text)}`).toBe(
				false,
			);
			expect(TEXT.startsWith(text)).toBe(true);
		}
		expect((await shownAfter(4000, { reveal: "token" })).text).toBe(TEXT);
	});
});
