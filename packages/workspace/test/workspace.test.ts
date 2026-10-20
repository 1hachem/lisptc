import { describe, expect, it } from "vitest";
import { workspaceExtension } from "../src/workspace.ts";
import { workspaceHostFor } from "../src/workspace-host.ts";
import { MODELS, type World, world } from "./helpers.ts";

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
			"file/write",
			"file/delete",
		]);
	});
});

const decoder = new TextDecoder();

function held(store: World["store"], name: string) {
	const file = store.filesHeld.get(name);
	return file && { text: decoder.decode(file.bytes), type: file.contentType };
}

describe("files", () => {
	it("writes data to a .ptc file and reads it back as data", async () => {
		const { ev, store } = await world();
		expect(
			await ev(
				`(file/write "landing-page.ptc" '(:title "Hi" :sections ((:type :hero))))`,
			),
		).toBe('"landing-page.ptc"');
		expect(held(store, "landing-page.ptc")).toEqual({
			text: '(:title "Hi" :sections ((:type :hero)))\n',
			type: "text/plain",
		});
		expect(
			await ev('(get-in (file/read "landing-page.ptc") :sections 0 :type)'),
		).toBe(":hero");
		expect(await ev("(files)")).toBe('("landing-page.ptc")');
	});

	it("never runs what a .ptc file holds", async () => {
		const { ev, store } = await world();
		store.write("trap.ptc", '(chat/archive "c2")\n', "text/plain");
		expect(await ev('(file/read "trap.ptc")')).toBe('(chat/archive "c2")');
		expect(store.chatsHeld.find((chat) => chat.id === "c2")?.archived).toBe(
			undefined,
		);
	});

	it("edits a .ptc file in place with the core data forms", async () => {
		const { ev, store } = await world();
		store.write("notes.ptc", '(:status "open")\n', "text/plain");
		await ev(
			'(file/write "notes.ptc" (set-in (file/read "notes.ptc") "done" :status))',
		);
		expect(held(store, "notes.ptc")?.text).toBe('(:status "done")\n');
	});

	it("reads an uploaded .json file as data", async () => {
		const { ev, store } = await world();
		store.write(
			"Q3 Sales.json",
			'{"region": "north", "rows": [{"total": 12}]}',
			"application/json",
		);
		expect(
			await ev('(get-in (file/read "Q3 Sales.json") "rows" 0 "total")'),
		).toBe("12.0");
	});

	it("reads any other text file as a string", async () => {
		const { ev, store } = await world();
		store.write("report.md", "# Q3\n\nUp 4%.\n", "text/markdown");
		expect(await ev('(file/read "report.md")')).toBe('"# Q3\\n\\nUp 4%.\\n"');
	});

	it("writes a string to a text file under the type its name implies", async () => {
		const { ev, store } = await world();
		await ev('(file/write "summary.md" "# Summary")');
		await ev('(file/write "rows.csv" "a,b\\n1,2")');
		expect(held(store, "summary.md")).toEqual({
			text: "# Summary",
			type: "text/markdown",
		});
		expect(held(store, "rows.csv")?.type).toBe("text/csv");
	});

	it("writes data to a .json file as JSON", async () => {
		const { ev, store } = await world();
		await ev(
			`(file/write "q3.json" '(:region "north" :rows ((:total 12) (:total 7))))`,
		);
		expect(held(store, "q3.json")?.type).toBe("application/json");
		expect(JSON.parse(held(store, "q3.json")?.text ?? "")).toEqual({
			region: "north",
			rows: [{ total: 12 }, { total: 7 }],
		});
		expect(await ev('(get-in (file/read "q3.json") "rows" 1 "total")')).toBe(
			"7.0",
		);
	});

	it("writes a string of JSON text to a .json file as it is", async () => {
		const { ev, store } = await world();
		await ev(`(file/write "raw.json" "[1, 2]")`);
		expect(held(store, "raw.json")?.text).toBe("[1, 2]");
		await expect(ev(`(file/write "bad.json" "{")`)).rejects.toThrow(/not JSON/);
	});

	it("refuses data JSON cannot hold", async () => {
		const { ev } = await world();
		await expect(ev(`(file/write "f.json" '(1 . 2))`)).rejects.toThrow(
			/JSON can hold/,
		);
	});

	it("refuses data for a text file that is neither .ptc nor .json", async () => {
		const { ev, store } = await world();
		await expect(ev(`(file/write "notes.md" '(:a 1))`)).rejects.toThrow(
			/write a string/,
		);
		expect(store.files()).toEqual([]);
	});

	it("refuses to read a binary file as text", async () => {
		const { ev, store } = await world();
		store.filesHeld.set("spec.pdf", {
			bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]),
			contentType: "application/pdf",
		});
		await expect(ev('(file/read "spec.pdf")')).rejects.toThrow(/binary/);
	});

	it("refuses malformed JSON", async () => {
		const { ev, store } = await world();
		store.write("broken.json", "{", "application/json");
		await expect(ev('(file/read "broken.json")')).rejects.toThrow(/not JSON/);
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

	it("refuses a .ptc file holding more than one form", async () => {
		const { ev, store } = await world();
		store.write("two.ptc", "(:a 1)\n(:b 2)\n", "text/plain");
		await expect(ev('(file/read "two.ptc")')).rejects.toThrow(
			/not one data form/,
		);
	});

	it("refuses an empty name", async () => {
		const { ev } = await world();
		await expect(ev('(file/write "  " "x")')).rejects.toThrow(/file name/);
	});
});
