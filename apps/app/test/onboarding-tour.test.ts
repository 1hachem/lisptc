import { describe, expect, it } from "vitest";
import { tourOf } from "../src/lib/onboarding-tour.ts";

describe("reading an onboarding script", () => {
	it("gives each step of a tour in order", () => {
		expect(
			tourOf(`(ui/tour "welcome"
       '(:anchor "chats/new" :say "Start chat here" :until click)
       '(:page settings :say "Ask me anything")
       :done "thanks")`),
		).toEqual({
			id: "welcome",
			steps: [
				{
					say: "Start chat here",
					anchor: "chats/new",
					page: undefined,
					waitsForClick: true,
				},
				{
					say: "Ask me anything",
					anchor: undefined,
					page: "settings",
					waitsForClick: false,
				},
			],
		});
	});

	it("reads a step written as a quote call", () => {
		expect(
			tourOf('(ui/tour "tips" (quote (:say "hi")))')?.steps.map(
				(step) => step.say,
			),
		).toEqual(["hi"]);
	});

	it("gives nothing for a script that is not a tour", () => {
		expect(tourOf("(+ 1 2)")).toBeUndefined();
		expect(tourOf('(ui/tour "empty")')).toBeUndefined();
		expect(tourOf('(ui/tour "odd" \'(:say))')).toBeUndefined();
	});
});
