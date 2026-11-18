import { MAX_FILE_NAME } from "@repo/shared/files";
import { describe, expect, it } from "vitest";
import { MemoryKnowledgeStore } from "../src/memory-store.ts";
import { world } from "./helpers.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("the in-memory knowledge store, held to what the deployment does", () => {
	it("numbers a binned name the bin already holds instead of losing the older file", async () => {
		const { ev } = await world();
		await ev('(attachments/write "a.md" "first") (attachments/delete "a.md")');
		await ev('(attachments/write "a.md" "second") (attachments/delete "a.md")');
		expect(await ev("(bin/list)")).toBe('("a (2).md" "a.md")');
		await ev('(bin/restore "a.md")');
		expect(await ev('(attachments/read "a.md")')).toBe('"first"');
	});

	it("keeps a numbered bin name under the length cap", () => {
		const store = new MemoryKnowledgeStore();
		const long = `${"x".repeat(MAX_FILE_NAME - 3)}.md`;
		store.write("knowledge", long, bytes("1"), "text/markdown");
		store.remove("knowledge", long);
		store.write("knowledge", long, bytes("2"), "text/markdown");
		store.remove("knowledge", long);
		const [newest] = store.binned();
		expect(newest.name).toHaveLength(MAX_FILE_NAME);
		expect(newest.name.endsWith(" (2).md")).toBe(true);
	});

	it("numbers an attachment written under a taken name", () => {
		const store = new MemoryKnowledgeStore();
		expect(
			store.write("attachments", "spec.pdf", bytes("1"), "application/pdf"),
		).toBe("spec.pdf");
		expect(
			store.write("attachments", "spec.pdf", bytes("2"), "application/pdf"),
		).toBe("spec (2).pdf");
		expect(store.names("attachments")).toEqual(["spec (2).pdf", "spec.pdf"]);
	});

	it("replaces a knowledge file and bins the old one", () => {
		const store = new MemoryKnowledgeStore();
		store.write("knowledge", "notes.md", bytes("old"), "text/markdown");
		expect(
			store.write("knowledge", "notes.md", bytes("new"), "text/markdown"),
		).toBe("notes.md");
		expect(store.read("knowledge", "notes.md")).toEqual(bytes("new"));
		expect(store.binned()).toEqual([{ name: "notes.md", from: "knowledge" }]);
	});

	it("lists the bin newest first", async () => {
		const { ev } = await world();
		for (const name of ["one.md", "two.md", "three.md"])
			await ev(`(knowledge/write "${name}" "x") (knowledge/delete "${name}")`);
		expect(await ev("(bin/list)")).toBe('("three.md" "two.md" "one.md")');
	});

	it("restores under a numbered name when the folder took the old one", () => {
		const store = new MemoryKnowledgeStore();
		store.write("knowledge", "a.md", bytes("old"), "text/markdown");
		store.remove("knowledge", "a.md");
		store.write("knowledge", "a.md", bytes("new"), "text/markdown");
		expect(store.restore("a.md")).toEqual({
			name: "a (2).md",
			from: "knowledge",
		});
		expect(store.read("knowledge", "a (2).md")).toEqual(bytes("old"));
	});
});
