import { describe, expect, it } from "vitest";
import { knowledgeExtension } from "../src/knowledge.ts";
import { knowledgeHostFor } from "../src/knowledge-host.ts";
import { MemoryKnowledgeStore } from "../src/ports.ts";
import { pdfSaying, type World, world } from "./helpers.ts";

const decoder = new TextDecoder();

function held(store: World["store"], name: string) {
	const file = store.filesHeld.get(name);
	return file && { text: decoder.decode(file.bytes), type: file.contentType };
}

describe("what waits on the user", () => {
	it("asks before writing or deleting a file", () => {
		const extension = knowledgeExtension(
			knowledgeHostFor({ store: new MemoryKnowledgeStore() }),
		);
		expect(extension.asks).toEqual(["knowledge/write", "knowledge/delete"]);
	});
});

describe("knowledge", () => {
	it("writes data to a .ptc file and reads it back as data", async () => {
		const { ev, store } = await world();
		expect(
			await ev(
				`(knowledge/write "landing-page.ptc" '(:title "Hi" :sections ((:type :hero))))`,
			),
		).toBe('"landing-page.ptc"');
		expect(held(store, "landing-page.ptc")).toEqual({
			text: '(:title "Hi" :sections ((:type :hero)))\n',
			type: "text/plain",
		});
		expect(
			await ev(
				'(get-in (knowledge/read "landing-page.ptc") :sections 0 :type)',
			),
		).toBe(":hero");
		expect(await ev("(knowledge/list)")).toBe('("landing-page.ptc")');
	});

	it("never runs what a .ptc file holds", async () => {
		const { ev, store } = await world();
		store.write("a.md", "# a", "text/markdown");
		store.write("trap.ptc", '(knowledge/delete "a.md")\n', "text/plain");
		expect(await ev('(knowledge/read "trap.ptc")')).toBe(
			'(knowledge/delete "a.md")',
		);
		expect(store.files()).toEqual(["a.md", "trap.ptc"]);
	});

	it("edits a .ptc file in place with the core data forms", async () => {
		const { ev, store } = await world();
		store.write("notes.ptc", '(:status "open")\n', "text/plain");
		await ev(
			'(knowledge/write "notes.ptc" (set-in (knowledge/read "notes.ptc") "done" :status))',
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
			await ev('(get-in (knowledge/read "Q3 Sales.json") "rows" 0 "total")'),
		).toBe("12.0");
	});

	it("reads any other text file as a string", async () => {
		const { ev, store } = await world();
		store.write("report.md", "# Q3\n\nUp 4%.\n", "text/markdown");
		expect(await ev('(knowledge/read "report.md")')).toBe(
			'"# Q3\\n\\nUp 4%.\\n"',
		);
	});

	it("writes a string to a text file under the type its name implies", async () => {
		const { ev, store } = await world();
		await ev('(knowledge/write "summary.md" "# Summary")');
		await ev('(knowledge/write "rows.csv" "a,b\\n1,2")');
		expect(held(store, "summary.md")).toEqual({
			text: "# Summary",
			type: "text/markdown",
		});
		expect(held(store, "rows.csv")?.type).toBe("text/csv");
	});

	it("writes data to a .json file as JSON", async () => {
		const { ev, store } = await world();
		await ev(
			`(knowledge/write "q3.json" '(:region "north" :rows ((:total 12) (:total 7))))`,
		);
		expect(held(store, "q3.json")?.type).toBe("application/json");
		expect(JSON.parse(held(store, "q3.json")?.text ?? "")).toEqual({
			region: "north",
			rows: [{ total: 12 }, { total: 7 }],
		});
		expect(
			await ev('(get-in (knowledge/read "q3.json") "rows" 1 "total")'),
		).toBe("7.0");
	});

	it("writes a string of JSON text to a .json file as it is", async () => {
		const { ev, store } = await world();
		await ev(`(knowledge/write "raw.json" "[1, 2]")`);
		expect(held(store, "raw.json")?.text).toBe("[1, 2]");
		await expect(ev(`(knowledge/write "bad.json" "{")`)).rejects.toThrow(
			/not JSON/,
		);
	});

	it("refuses data JSON cannot hold", async () => {
		const { ev } = await world();
		await expect(ev(`(knowledge/write "f.json" '(1 . 2))`)).rejects.toThrow(
			/JSON can hold/,
		);
	});

	it("refuses data for a text file that is neither .ptc nor .json", async () => {
		const { ev, store } = await world();
		await expect(ev(`(knowledge/write "notes.md" '(:a 1))`)).rejects.toThrow(
			/write a string/,
		);
		expect(store.files()).toEqual([]);
	});

	it("refuses to read a binary file as text", async () => {
		const { ev, store } = await world();
		store.filesHeld.set("logo.png", {
			bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
			contentType: "image/png",
		});
		await expect(ev('(knowledge/read "logo.png")')).rejects.toThrow(/binary/);
	});

	it("reads the text of every page of a .pdf file", async () => {
		const { ev, store } = await world();
		store.filesHeld.set("spec.pdf", {
			bytes: pdfSaying("Q3 revenue up", "Churn flat"),
			contentType: "application/pdf",
		});
		const read = await ev('(knowledge/read "spec.pdf")');
		expect(read).toMatch(/^".*Q3 revenue up.*Churn flat.*"$/s);
	});

	it("refuses a .pdf file that is not a PDF", async () => {
		const { ev, store } = await world();
		store.filesHeld.set("spec.pdf", {
			bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]),
			contentType: "application/pdf",
		});
		await expect(ev('(knowledge/read "spec.pdf")')).rejects.toThrow(
			/not a readable PDF/,
		);
	});

	it("refuses malformed JSON", async () => {
		const { ev, store } = await world();
		store.write("broken.json", "{", "application/json");
		await expect(ev('(knowledge/read "broken.json")')).rejects.toThrow(
			/not JSON/,
		);
	});

	it("gives nil for a missing file", async () => {
		const { ev } = await world();
		expect(await ev('(knowledge/read "nope.ptc")')).toBe("nil");
	});

	it("deletes a file", async () => {
		const { ev, store } = await world();
		store.write("a.md", "# a", "text/markdown");
		expect(await ev('(knowledge/delete "a.md")')).toBe("t");
		expect(store.files()).toEqual([]);
	});

	it("refuses a value that does not read back", async () => {
		const { ev, store } = await world();
		await expect(
			ev('(knowledge/write "f.ptc" (lambda (x) x))'),
		).rejects.toThrow(/only data/);
		expect(store.files()).toEqual([]);
	});

	it("refuses a .ptc file holding more than one form", async () => {
		const { ev, store } = await world();
		store.write("two.ptc", "(:a 1)\n(:b 2)\n", "text/plain");
		await expect(ev('(knowledge/read "two.ptc")')).rejects.toThrow(
			/not one data form/,
		);
	});

	it("refuses an empty name", async () => {
		const { ev } = await world();
		await expect(ev('(knowledge/write "  " "x")')).rejects.toThrow(/file name/);
	});
});
