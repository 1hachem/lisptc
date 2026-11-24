import { describe, expect, it } from "vitest";
import { world } from "./helpers.ts";

describe("settings", () => {
	it("flips the current theme to its dark counterpart", async () => {
		const { ev, store } = await world("c1", "tokyonight-light");
		await ev('(settings/set :theme "dark")');
		expect(store.settings().theme).toBe("tokyonight-dark");
	});

	it("keeps a theme that is already dark", async () => {
		const { ev, store } = await world("c1", "tokyonight-dark");
		await ev('(settings/set :theme "dark")');
		expect(store.settings().theme).toBe("tokyonight-dark");
	});

	it("falls back to the default dark theme when there is no counterpart", async () => {
		const { ev, store } = await world("c1", "paper");
		await ev('(settings/set :theme "dark")');
		expect(store.settings().theme).toBe("gruvbox-dark");
	});

	it("refuses a theme that is not offered, and changes nothing", async () => {
		const { ev, store } = await world();
		await expect(ev('(settings/set :name "x" :theme "neon")')).rejects.toThrow(
			/theme not offered/,
		);
		expect(store.settings()).toMatchObject({
			name: "personal",
			theme: "gruvbox-dark",
		});
	});

	it("refuses an icon that is not offered, and changes nothing", async () => {
		const { ev, store } = await world();
		await expect(
			ev('(settings/set :name "x" :icon "unicorn")'),
		).rejects.toThrow(/icon not offered/);
		expect(store.settings()).toMatchObject({
			name: "personal",
			icon: "folder",
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

	it("lists archived chats apart and brings one back", async () => {
		const { ev } = await world("c1");
		await ev('(chat/archive "c2")');
		expect(await ev("(chats :archived t)")).toBe(
			'((:id "c2" :title "plan q4"))',
		);
		expect(await ev('(chat/unarchive "c2")')).toBe("t");
		expect(await ev("(chats)")).toContain("c2");
		expect(await ev("(chats :archived t)")).toBe("nil");
	});

	it("reads the last messages of another chat", async () => {
		const { ev } = await world();
		expect(await ev('(chat/read "c3" :last 2)')).toBe(
			'(("ai" . "second") ("human" . "third"))',
		);
	});
});
