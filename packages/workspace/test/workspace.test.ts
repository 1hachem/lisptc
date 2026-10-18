import { describe, expect, it } from "vitest";
import { workspaceExtension } from "../src/workspace.ts";
import { workspaceHostFor } from "../src/workspace-host.ts";
import { MODELS, world } from "./helpers.ts";

describe("settings", () => {
	it("reads as the plist the sidebar file shows", async () => {
		const { ev } = await world();
		expect(await ev("(settings)")).toBe(
			'(:name "personal" :model "openrouter/google/gemma-4-31b-it")',
		);
	});

	it("lists the models on offer", async () => {
		const { ev } = await world();
		expect(await ev("(settings/models)")).toBe(
			'("openrouter/google/gemma-4-31b-it" "digitalocean/gemma")',
		);
	});

	it("changes the name and the model it is given", async () => {
		const { ev, store } = await world();
		expect(
			await ev('(settings/set :name "research" :model "digitalocean/gemma")'),
		).toBe('(:name "research" :model "digitalocean/gemma")');
		expect(store.settings()).toEqual({
			name: "research",
			model: "digitalocean/gemma",
		});
	});

	it("refuses a model that is not offered, and changes nothing", async () => {
		const { ev, store } = await world();
		await expect(
			ev('(settings/set :name "x" :model "openai/gpt-9")'),
		).rejects.toThrow(/model not offered/);
		expect(store.settings().name).toBe("personal");
	});
});

describe("chats", () => {
	it("lists them, narrowed by a search and a limit", async () => {
		const { ev } = await world();
		expect(await ev('(chats :search "login")')).toBe(
			'((:id "c1" :title "fix login") (:id "c3" :title "login copy"))',
		);
		expect(await ev("(chats :limit 1)")).toBe(
			'((:id "c1" :title "fix login"))',
		);
	});

	it("titles the chat the session is in", async () => {
		const { ev, store } = await world("c2");
		await ev('(chat/title "  quarter plan  ")');
		expect(store.chatsHeld.find((c) => c.id === "c2")?.title).toBe(
			"quarter plan",
		);
	});

	it("refuses to title a chat when the session is in none", async () => {
		const { ev } = await world(null);
		await expect(ev('(chat/title "x")')).rejects.toThrow(/in no chat/);
	});

	it("archives another chat but never the one it is in", async () => {
		const { ev, store } = await world("c1");
		await ev('(chat/archive "c2")');
		expect(await ev("(chats)")).not.toContain("c2");
		await expect(ev('(chat/archive "c1")')).rejects.toThrow(/you are in/);
		expect(
			store.chatsHeld.find((c) => c.id === "c1")?.archived,
		).toBeUndefined();
	});

	it("reads the last messages of another chat", async () => {
		const { ev } = await world();
		expect(await ev('(chat/read "c3" :last 2)')).toBe(
			'(("ai" . "second") ("human" . "third"))',
		);
	});
});

describe("what waits on the user", () => {
	it("asks before changing settings, archiving or reading another chat, or deleting a file", async () => {
		const { store } = await world();
		const extension = workspaceExtension(
			workspaceHostFor({ store, models: MODELS }),
		);
		expect(extension.asks).toEqual([
			"settings/set",
			"chat/archive",
			"chat/read",
			"file/delete",
		]);
	});
});

describe("files", () => {
	it("writes a value as printed data and reads it back as data", async () => {
		const { ev, store } = await world();
		expect(
			await ev(
				`(file/write "landing-page.ptc" '(:title "Hi" :sections ((:type :hero))))`,
			),
		).toBe('"landing-page.ptc"');
		expect(store.file("landing-page.ptc")).toBe(
			'(:title "Hi" :sections ((:type :hero)))\n',
		);
		expect(
			await ev('(get-in (file/read "landing-page.ptc") :sections 0 :type)'),
		).toBe(":hero");
		expect(await ev("(files)")).toBe('("landing-page.ptc")');
	});

	it("never runs what a file holds", async () => {
		const { ev, store } = await world();
		store.write("trap.ptc", '(chat/archive "c2")\n');
		expect(await ev('(file/read "trap.ptc")')).toBe('(chat/archive "c2")');
		expect(store.chatsHeld.find((chat) => chat.id === "c2")?.archived).toBe(
			undefined,
		);
	});

	it("edits a file in place with the core data forms", async () => {
		const { ev, store } = await world();
		store.write("notes.ptc", '(:status "open")\n');
		await ev(
			'(file/write "notes.ptc" (set-in (file/read "notes.ptc") "done" :status))',
		);
		expect(store.file("notes.ptc")).toBe('(:status "done")\n');
	});

	it("gives nil for a missing file", async () => {
		const { ev } = await world();
		expect(await ev('(file/read "nope.ptc")')).toBe("nil");
	});

	it("refuses a value that does not read back", async () => {
		const { ev, store } = await world();
		await expect(ev('(file/write "f.ptc" (lambda (x) x))')).rejects.toThrow(
			/only data/,
		);
		expect(store.files()).toEqual([]);
	});

	it("refuses a file holding more than one form", async () => {
		const { ev, store } = await world();
		store.write("two.ptc", "(:a 1)\n(:b 2)\n");
		await expect(ev('(file/read "two.ptc")')).rejects.toThrow(
			/not one data form/,
		);
	});

	it.each([
		"../escape.ptc",
		"Landing.ptc",
		"notes.txt",
		"/abs.ptc",
		"a//b.ptc",
	])("refuses the path %s", async (path) => {
		const { ev } = await world();
		await expect(ev(`(file/write "${path}" 1)`)).rejects.toThrow(/file path/);
	});
});
