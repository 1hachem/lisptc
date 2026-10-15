import { describe, expect, it } from "vitest";
import { preferencesHost } from "../src/preferences-host.ts";
import { world } from "./helpers.ts";

const HELD = {
	theme: "gruvbox-dark",
	font: "geist",
	channels: { lisp: false, thinking: true },
	metadata: { tokens: true },
};

describe("reading preferences", () => {
	it("gives them as the plist the sidebar file shows", async () => {
		const { ev } = await world(HELD);
		expect(await ev("(preferences)")).toBe(
			'(:theme "gruvbox-dark" :font "geist" :channels (:lisp nil :thinking t) :metadata (:tokens t))',
		);
	});

	it("lists the themes and fonts there are to choose from", async () => {
		const { ev } = await world();
		expect(await ev("(themes)")).toBe(
			'(("gruvbox-dark" . "gruvbox dark") ("gruvbox-light" . "gruvbox light"))',
		);
		expect(await ev("(fonts)")).toBe('(("geist" . "Geist"))');
	});
});

describe("changing preferences", () => {
	it("changes only the keys it is given", async () => {
		const { ev, store } = await world(HELD);
		await ev('(preferences/set :theme "gruvbox-light")');
		expect(store.read()).toEqual({ ...HELD, theme: "gruvbox-light" });
	});

	it("merges toggles and keeps the ones it does not name", async () => {
		const { ev, store } = await world(HELD);
		expect(await ev("(preferences/set :channels '(:lisp t))")).toContain(
			":channels (:lisp t :thinking t)",
		);
		expect(store.read().channels).toEqual({ lisp: true, thinking: true });
	});

	it("refuses a theme or font the app does not offer", async () => {
		const { ev, store } = await world(HELD);
		await expect(ev('(preferences/set :theme "neon")')).rejects.toThrow(
			/unknown theme/,
		);
		await expect(ev('(preferences/set :font "comic")')).rejects.toThrow(
			/unknown font/,
		);
		expect(store.read()).toEqual(HELD);
	});

	it("refuses a toggle the app has never listed", async () => {
		const { ev } = await world(HELD);
		await expect(ev("(preferences/set :channels '(:bogus t))")).rejects.toThrow(
			/:lisp :thinking/,
		);
	});

	it("takes only t or nil for a toggle", async () => {
		const { ev } = await world(HELD);
		await expect(
			ev('(preferences/set :channels \'(:lisp "yes"))'),
		).rejects.toThrow(/t or nil/);
	});

	it("refuses a call that sets nothing", async () => {
		const { ev } = await world(HELD);
		await expect(ev("(preferences/set)")).rejects.toThrow(/nothing to set/);
	});
});

describe("the prompt", () => {
	it("teaches the forms it installs", () => {
		const prompt = preferencesHost.prompt();
		for (const form of ["(preferences)", "(preferences/set", "(themes)"])
			expect(prompt).toContain(form);
	});
});
