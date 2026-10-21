import { describe, expect, it } from "vitest";
import { preferencesHost } from "../src/preferences-host.ts";
import { world } from "./helpers.ts";

const HELD = {
	font: "geist",
	channels: { lisp: false, thinking: true },
	metadata: { tokens: true },
	input: { lisp: true, send: true },
	sendLabel: "send",
	sidebar: ["home", "chat", "memories", "README.md"],
	hidden: ["memories"],
	statusBar: ["minimized", "panes", "clock"],
	statusBarHidden: [],
	motion: "slide",
	panelMotion: true,
};

describe("reading preferences", () => {
	it("gives them as the plist the sidebar file shows", async () => {
		const { ev } = await world(HELD);
		expect(await ev("(preferences)")).toBe(
			'(:font "geist" :channels (:lisp nil :thinking t) :metadata (:tokens t) :input (:lisp t :send t) :send-label "send" :sidebar ("home" "chat" "memories" "README.md") :hidden ("memories") :status-bar ("minimized" "panes" "clock") :status-bar-hidden nil :motion "slide" :panel-motion t)',
		);
	});

	it("lists the fonts and motions there are to choose from", async () => {
		const { ev } = await world();
		expect(await ev("(fonts)")).toBe('(("geist" . "Geist"))');
		expect(await ev("(motions)")).toBe(
			'(("slide" . "rows slide") ("lift" . "the row lifts"))',
		);
	});
});

describe("changing preferences", () => {
	it("changes only the keys it is given", async () => {
		const { ev, store } = await world(HELD);
		await ev('(preferences/set :motion "lift")');
		expect(store.read()).toEqual({ ...HELD, motion: "lift" });
	});

	it("has no theme to set, the theme being the workspace's", async () => {
		const { ev } = await world(HELD);
		await expect(
			ev('(preferences/set :theme "gruvbox-light")'),
		).rejects.toThrow();
		await expect(ev("(themes)")).rejects.toThrow();
	});

	it("merges toggles and keeps the ones it does not name", async () => {
		const { ev, store } = await world(HELD);
		expect(await ev("(preferences/set :channels '(:lisp t))")).toContain(
			":channels (:lisp t :thinking t)",
		);
		expect(store.read().channels).toEqual({ lisp: true, thinking: true });
	});

	it("changes what the chat input shows and how it behaves, and keeps the rest", async () => {
		const { ev, store } = await world(HELD);
		expect(await ev("(preferences/set :input '(:send nil))")).toContain(
			":input (:lisp t :send nil)",
		);
		expect(store.read().input).toEqual({ lisp: true, send: false });
	});

	it("relabels the send button", async () => {
		const { ev, store } = await world(HELD);
		expect(await ev('(preferences/set :send-label " go ")')).toContain(
			':send-label "go"',
		);
		expect(store.read().sendLabel).toBe("go");
	});

	it("refuses a send label that is empty or too long", async () => {
		const { ev, store } = await world(HELD);
		await expect(ev('(preferences/set :send-label "  ")')).rejects.toThrow(
			/1 to 16 characters/,
		);
		await expect(
			ev('(preferences/set :send-label "a label far too long")'),
		).rejects.toThrow(/1 to 16 characters/);
		await expect(ev("(preferences/set :send-label 3)")).rejects.toThrow(
			/must be a string/,
		);
		expect(store.read()).toEqual(HELD);
	});

	it("refuses a font the app does not offer", async () => {
		const { ev, store } = await world(HELD);
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

	it("reorders the bottom bar, keeping the items it does not name after", async () => {
		const { ev, store } = await world(HELD);
		expect(
			await ev('(preferences/set :status-bar \'("clock" "panes"))'),
		).toContain(':status-bar ("clock" "panes" "minimized")');
		expect(store.read().statusBar).toEqual(["clock", "panes", "minimized"]);
	});

	it("hides bottom bar items and shows them again", async () => {
		const { ev, store } = await world(HELD);
		await ev('(preferences/set :status-bar-hidden \'("clock"))');
		expect(store.read().statusBarHidden).toEqual(["clock"]);
		await ev("(preferences/set :status-bar-hidden '())");
		expect(store.read().statusBarHidden).toEqual([]);
	});

	it("refuses a bottom bar item the app has never listed", async () => {
		const { ev, store } = await world(HELD);
		await expect(
			ev('(preferences/set :status-bar-hidden \'("weather"))'),
		).rejects.toThrow(
			/unknown status bar item, there are "minimized" "panes" "clock"/,
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

	it("turns panel animation off and back on", async () => {
		const { ev, store } = await world(HELD);
		await ev("(preferences/set :panel-motion nil)");
		expect(store.read().panelMotion).toBe(false);
		expect(await ev("(preferences)")).toContain(":panel-motion nil");
		await ev("(preferences/set :panel-motion t)");
		expect(store.read().panelMotion).toBe(true);
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
			"(fonts)",
			"(motions)",
		])
			expect(prompt).toContain(form);
	});
});
