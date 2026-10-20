import { describe, expect, it } from "vitest";
import { preferencesHost } from "../src/preferences-host.ts";
import { world } from "./helpers.ts";

const HELD = {
	theme: "gruvbox-dark",
	font: "geist",
	channels: { lisp: false, thinking: true },
	metadata: { tokens: true },
	sidebar: ["home", "chat", "memories", "README.md"],
	hidden: ["memories"],
	motion: "slide",
};

describe("reading preferences", () => {
	it("gives them as the plist the sidebar file shows", async () => {
		const { ev } = await world(HELD);
		expect(await ev("(preferences)")).toBe(
			'(:theme "gruvbox-dark" :font "geist" :channels (:lisp nil :thinking t) :metadata (:tokens t) :sidebar ("home" "chat" "memories" "README.md") :hidden ("memories") :motion "slide")',
		);
	});

	it("lists the themes and fonts there are to choose from", async () => {
		const { ev } = await world();
		expect(await ev("(themes)")).toBe(
			'(("gruvbox-dark" . "gruvbox dark") ("gruvbox-light" . "gruvbox light") ("tokyonight-dark" . "tokyonight dark") ("tokyonight-light" . "tokyonight light") ("paper" . "paper light"))',
		);
		expect(await ev("(fonts)")).toBe('(("geist" . "Geist"))');
		expect(await ev("(motions)")).toBe(
			'(("slide" . "rows slide") ("lift" . "the row lifts"))',
		);
	});
});

describe("changing preferences", () => {
	it("changes only the keys it is given", async () => {
		const { ev, store } = await world(HELD);
		await ev('(preferences/set :theme "gruvbox-light")');
		expect(store.read()).toEqual({ ...HELD, theme: "gruvbox-light" });
	});

	it("flips the current theme to its dark counterpart", async () => {
		const { ev, store } = await world({ ...HELD, theme: "tokyonight-light" });
		await ev('(preferences/set :theme "dark")');
		expect(store.read().theme).toBe("tokyonight-dark");
	});

	it("keeps a theme that is already dark", async () => {
		const { ev, store } = await world({ ...HELD, theme: "tokyonight-dark" });
		await ev('(preferences/set :theme "dark")');
		expect(store.read().theme).toBe("tokyonight-dark");
	});

	it("falls back to the default dark theme when there is no counterpart", async () => {
		const { ev, store } = await world({ ...HELD, theme: "paper" });
		await ev('(preferences/set :theme "dark")');
		expect(store.read().theme).toBe("gruvbox-dark");
	});

	it("falls back to the default dark theme when no theme is stored", async () => {
		const { ev, store } = await world();
		await ev('(preferences/set :theme "dark")');
		expect(store.read().theme).toBe("gruvbox-dark");
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

	it("moves the named sidebar entries to the top and keeps the rest in order", async () => {
		const { ev, store } = await world(HELD);
		expect(
			await ev('(preferences/set :sidebar \'("README.md" "chat"))'),
		).toContain(':sidebar ("README.md" "chat" "home" "memories")');
		expect(store.read().sidebar).toEqual([
			"README.md",
			"chat",
			"home",
			"memories",
		]);
	});

	it("refuses a sidebar entry the app has never listed", async () => {
		const { ev, store } = await world(HELD);
		await expect(ev('(preferences/set :sidebar \'("bogus"))')).rejects.toThrow(
			/"home" "chat" "memories" "README.md"/,
		);
		expect(store.read()).toEqual(HELD);
	});

	it("refuses a sidebar entry named twice", async () => {
		const { ev } = await world(HELD);
		await expect(
			ev('(preferences/set :sidebar \'("chat" "chat"))'),
		).rejects.toThrow(/named twice/);
	});

	it("replaces the hidden sidebar entries, so an entry left out is shown again", async () => {
		const { ev, store } = await world(HELD);
		expect(
			await ev('(preferences/set :hidden \'("README.md" "chat"))'),
		).toContain(':hidden ("README.md" "chat")');
		expect(store.read().hidden).toEqual(["README.md", "chat"]);
		await ev("(preferences/set :hidden '())");
		expect(store.read().hidden).toEqual([]);
	});

	it("refuses to hide a sidebar entry the app has never listed", async () => {
		const { ev, store } = await world(HELD);
		await expect(ev('(preferences/set :hidden \'("bogus"))')).rejects.toThrow(
			/unknown sidebar entry/,
		);
		expect(store.read()).toEqual(HELD);
	});

	it("sets how the sidebar animates a drag, and refuses a motion it does not offer", async () => {
		const { ev, store } = await world(HELD);
		await ev('(preferences/set :motion "lift")');
		expect(store.read().motion).toBe("lift");
		await expect(ev('(preferences/set :motion "spin")')).rejects.toThrow(
			/unknown motion, see \(motions\)/,
		);
	});

	it("refuses a call that sets nothing", async () => {
		const { ev } = await world(HELD);
		await expect(ev("(preferences/set)")).rejects.toThrow(/nothing to set/);
	});
});

describe("the prompt", () => {
	it("teaches the forms it installs", () => {
		const prompt = preferencesHost.prompt();
		for (const form of [
			"(preferences)",
			"(preferences/set",
			"(themes)",
			"(motions)",
		])
			expect(prompt).toContain(form);
	});
});
