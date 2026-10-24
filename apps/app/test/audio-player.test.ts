import { describe, expect, it } from "vitest";
import { clock } from "../src/components/audio-player.tsx";

describe("the audio player's clock", () => {
	it("reads seconds as minutes and padded seconds", () => {
		expect(clock(0)).toBe("0:00");
		expect(clock(7.9)).toBe("0:07");
		expect(clock(204)).toBe("3:24");
	});

	it("shows a blank length until the file reports one", () => {
		expect(clock(Number.NaN)).toBe("-:--");
		expect(clock(Number.POSITIVE_INFINITY)).toBe("-:--");
	});
});
