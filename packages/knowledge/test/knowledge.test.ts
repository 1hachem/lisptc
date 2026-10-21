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
	it("asks before writing, deleting, keeping or restoring a file, or fetching a url", () => {
		const extension = knowledgeExtension(
			knowledgeHostFor({ store: new MemoryKnowledgeStore() }),
		);
		expect(extension.asks).toEqual([
			"knowledge/write",
			"knowledge/delete",
			"knowledge/keep",
			"attachments/fetch",
			"attachments/delete",
			"bin/restore",
			"bin/delete",
		]);
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

	it("deletes a file into the bin", async () => {
		const { ev, store } = await world();
		store.write("a.md", "# a", "text/markdown");
		expect(await ev('(knowledge/delete "a.md")')).toBe("t");
		expect(store.files()).toEqual([]);
		expect(store.binned()).toEqual([{ name: "a.md", from: "knowledge" }]);
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

describe("attachments", () => {
	it("reads what the user attached, then keeps it as knowledge", async () => {
		const { ev, store } = await world();
		store.attachmentsHeld.set("spec.pdf", {
			bytes: pdfSaying("Q3 revenue up"),
			contentType: "application/pdf",
		});
		expect(await ev("(attachments/list)")).toBe('("spec.pdf")');
		expect(await ev('(attachments/read "spec.pdf")')).toMatch(/Q3 revenue up/);
		expect(await ev('(knowledge/keep "spec.pdf")')).toBe('"spec.pdf"');
		expect(store.attachments()).toEqual([]);
		expect(store.files()).toEqual(["spec.pdf"]);
		expect(await ev('(knowledge/read "spec.pdf")')).toMatch(/Q3 revenue up/);
	});

	it("gives nil for a file attachments do not hold", async () => {
		const { ev } = await world();
		expect(await ev('(attachments/read "nope.md")')).toBe("nil");
	});

	it("writes text, or bytes given as base64, into attachments", async () => {
		const { ev, store } = await world();
		expect(await ev('(attachments/write "note.md" "# hi")')).toBe('"note.md"');
		expect(store.attachmentsHeld.get("note.md")?.contentType).toBe(
			"text/markdown",
		);
		await ev(
			'(attachments/write "dot.png" (list :base64 "iVBORw0K" :type "image/png"))',
		);
		expect(store.attachmentsHeld.get("dot.png")).toEqual({
			bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
			contentType: "image/png",
		});
	});

	it("refuses base64 that is not", async () => {
		const { ev } = await world();
		await expect(
			ev('(attachments/write "x.png" (list :base64 "!!" :type "image/png"))'),
		).rejects.toThrow(/not base64/);
	});

	it("fetches a url into attachments under the last part of its path", async () => {
		const fetched: string[] = [];
		const { ev, store } = await world({
			download: async (url) => {
				fetched.push(url.href);
				return { bytes: pdfSaying("hello"), contentType: "application/pdf" };
			},
		});
		expect(
			await ev('(attachments/fetch "https://example.com/docs/spec.pdf")'),
		).toBe('"spec.pdf"');
		expect(
			await ev('(attachments/fetch "https://example.com/a" "named.pdf")'),
		).toBe('"named.pdf"');
		expect(fetched).toEqual([
			"https://example.com/docs/spec.pdf",
			"https://example.com/a",
		]);
		expect(store.attachments()).toEqual(["named.pdf", "spec.pdf"]);
	});

	it("refuses a url that is not http, and says why a fetch failed", async () => {
		const { ev } = await world();
		await expect(
			ev('(attachments/fetch "file:///etc/passwd")'),
		).rejects.toThrow(/http or https/);
		await expect(
			ev('(attachments/fetch "https://example.com/a.pdf")'),
		).rejects.toThrow(/could not fetch .*offline/);
	});

	it("refuses to keep a name knowledge already holds", async () => {
		const { ev, store } = await world();
		store.write("a.md", "kept", "text/markdown");
		store.attach("a.md", new TextEncoder().encode("new"), "text/markdown");
		await expect(ev('(knowledge/keep "a.md")')).rejects.toThrow(
			/already holds/,
		);

		describe("attach", () => {
			it("shows an attachments or knowledge file to the user, naming its folder", async () => {
				const { ev, store, attached } = await world();
				await ev('(attachments/write "chart.svg" "<svg/>")');
				store.write("report.md", "# r", "text/markdown");
				expect(await ev('(attachments/attach "chart.svg")')).toBe(
					'"chart.svg"',
				);
				expect(await ev('(knowledge/attach "report.md")')).toBe('"report.md"');
				expect(attached).toEqual([
					{ folder: "attachments", name: "chart.svg" },
					{ folder: "knowledge", name: "report.md" },
				]);
			});

			it("refuses a file the folder does not hold", async () => {
				const { ev, store, attached } = await world();
				store.write("report.md", "# r", "text/markdown");
				await expect(ev('(attachments/attach "report.md")')).rejects.toThrow(
					/no file named report.md in attachments/,
				);
				expect(attached).toEqual([]);
			});
		});
	});
});

describe("bin", () => {
	async function binned() {
		const w = await world();
		w.store.write("Q3 Report.md", "# q3", "text/markdown");
		await w.ev('(attachments/write "spec.pdf" "spec")');
		await w.ev('(knowledge/delete "Q3 Report.md")');
		await w.ev('(attachments/delete "spec.pdf")');
		return w;
	}

	it("takes what knowledge and attachments delete", async () => {
		const { ev, store } = await binned();
		expect(store.files()).toEqual([]);
		expect(store.attachments()).toEqual([]);
		expect(await ev("(bin/list)")).toBe('("Q3 Report.md" "spec.pdf")');
	});

	it("searches names, ignoring case", async () => {
		const { ev } = await binned();
		expect(await ev('(bin/search "report")')).toBe('("Q3 Report.md")');
		expect(await ev('(bin/search "nothing")')).toBe("nil");
	});

	it("restores a file to the folder it came from", async () => {
		const { ev, store } = await binned();
		expect(await ev('(bin/restore "Q3 Report.md")')).toBe(
			'"knowledge/Q3 Report.md"',
		);
		expect(await ev('(bin/restore "spec.pdf")')).toBe('"attachments/spec.pdf"');
		expect(store.files()).toEqual(["Q3 Report.md"]);
		expect(store.attachments()).toEqual(["spec.pdf"]);
		expect(await ev("(bin/list)")).toBe("nil");
	});

	it("deletes a file for good", async () => {
		const { ev, store } = await binned();
		expect(await ev('(bin/delete "spec.pdf")')).toBe("t");
		expect(store.binned()).toEqual([
			{ name: "Q3 Report.md", from: "knowledge" },
		]);
		await expect(ev('(bin/delete "spec.pdf")')).rejects.toThrow(
			/no file spec.pdf in the bin/,
		);
	});
});
