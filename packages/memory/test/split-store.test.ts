import { mkdtempSync, readFileSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SplitMemoryStore } from "../src/memory-host.ts";
import type { Memory } from "../src/ports.ts";

function store() {
	const root = mkdtempSync(join(tmpdir(), "lisptc-split-"));
	const dir = join(root, "memories");
	const counters = join(root, ".lisptc", "memories");
	return { dir, counters, store: new SplitMemoryStore(dir, counters) };
}

function memory(over: Partial<Memory> = {}): Memory {
	return {
		key: "role",
		body: "you keep the books",
		links: new Map(),
		score: 1,
		used: 0,
		lastUsed: 1_000,
		...over,
	};
}

describe("SplitMemoryStore", () => {
	it("keeps the content apart from the counters", () => {
		const { dir, counters, store: s } = store();
		s.put(memory({ score: 2.5, used: 3, lastUsed: 42 }));
		expect(readFileSync(join(dir, "role.ptc"), "utf8")).toBe(
			'(memory "role" :body "you keep the books" :links nil)\n',
		);
		expect(readFileSync(join(counters, "role.ptc"), "utf8")).toBe(
			"(counters :score 2.5 :used 3.0 :last-used 42.0)\n",
		);
		expect(s.get("role")).toMatchObject({
			body: "you keep the books",
			score: 2.5,
			used: 3,
			lastUsed: 42,
		});
	});

	it("leaves the content file alone when only the counters move", () => {
		const { dir, store: s } = store();
		s.put(memory());
		const file = join(dir, "role.ptc");
		utimesSync(file, new Date(0), new Date(0));
		s.put(memory({ used: 9, lastUsed: 99 }));
		expect(statSync(file).mtimeMs).toBe(0);
		expect(s.get("role")?.used).toBe(9);
	});

	it("dates a memory with no counters by its file", () => {
		const { dir, counters, store: s } = store();
		s.put(memory());
		const fresh = new SplitMemoryStore(dir, join(counters, "elsewhere"));
		expect(fresh.get("role")?.lastUsed).toBe(
			statSync(join(dir, "role.ptc")).mtimeMs,
		);
	});

	it("deletes both halves", () => {
		const { store: s } = store();
		s.put(memory());
		expect(s.delete("role")).toBe(true);
		expect(s.get("role")).toBeUndefined();
		expect(s.all()).toEqual([]);
	});
});
