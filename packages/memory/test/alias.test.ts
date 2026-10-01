import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driveAsync } from "@repo/interpreter/drive";
import { Interp, runAsync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { describe, expect, it } from "vitest";
import { AliasBook, memoryExtension } from "../src/memory.ts";
import { FileAliasStore, memoryHost } from "../src/memory-host.ts";
import { type AliasStore, VolatileAliases } from "../src/ports.ts";

interface Fixture {
	interp: Interp;
	book: AliasBook;
	beginTurn(): Promise<void>;
}

function fixture(store: AliasStore = new VolatileAliases()): Fixture {
	const book = new AliasBook(store);
	const interp = new Interp({
		extensions: [memoryExtension(memoryHost, { book })],
	});
	runAsync(interp, prelude);
	return {
		interp,
		book,
		async beginTurn(): Promise<void> {
			await driveAsync(book.install(interp));
		},
	};
}

async function ev(f: Fixture, code: string): Promise<string> {
	return str((await runAsync(f.interp, code)).value);
}

describe("an alias binds a second name", () => {
	it("binds a name that already exists", async () => {
		const f = fixture();
		await ev(f, '(memory/alias "first" "car")');

		expect(await ev(f, "(first '(1 2 3))")).toBe("1");
	});

	it("takes quoted symbols as well as strings", async () => {
		const f = fixture();
		await ev(f, "(memory/alias 'first 'car)");

		expect(await ev(f, "(first '(1 2 3))")).toBe("1");
	});

	it("returns the name it bound", async () => {
		const f = fixture();

		expect(await ev(f, '(memory/alias "first" "car")')).toBe('"first"');
	});

	it("refuses to alias a name to itself", async () => {
		const f = fixture();

		await expect(ev(f, '(memory/alias "car" "car")')).rejects.toThrow();
	});
});

describe("an alias never replaces a name already taken", () => {
	it("leaves the existing binding alone", async () => {
		const f = fixture();
		await ev(f, '(memory/alias "car" "cdr")');

		expect(await ev(f, "(car '(1 2 3))")).toBe("1");
	});
});

describe("an alias waits for its target", () => {
	it("binds nothing while the target is undefined", async () => {
		const f = fixture();
		await ev(f, '(memory/alias "nav" "later/navigate")');

		await expect(ev(f, "(nav)")).rejects.toThrow();
	});

	it("binds as soon as the target appears", async () => {
		const f = fixture();
		await ev(f, '(memory/alias "nav" "later/navigate")');
		await ev(f, "(setq later/navigate (lambda (x) x))");
		await f.beginTurn();

		expect(await ev(f, "(nav 7)")).toBe("7");
	});

	it("reports whether each alias is bound yet", async () => {
		const f = fixture();
		await ev(f, '(memory/alias "first" "car")');
		await ev(f, '(memory/alias "nav" "later/navigate")');

		expect(await ev(f, "(memory/aliases)")).toBe(
			'(("first" "car" :bound) ("nav" "later/navigate" :waiting))',
		);
	});
});

describe("an alias is dropped by name", () => {
	it("removes the binding it installed", async () => {
		const f = fixture();
		await ev(f, '(memory/alias "first" "car")');

		expect(await ev(f, '(memory/unalias "first")')).toBe("t");
		await expect(ev(f, "(first '(1 2))")).rejects.toThrow();
	});

	it("leaves a name it never bound", async () => {
		const f = fixture();
		await ev(f, '(memory/alias "car" "cdr")');
		await ev(f, '(memory/unalias "car")');

		expect(await ev(f, "(car '(1 2 3))")).toBe("1");
	});

	it("answers nil when there was no such alias", async () => {
		const f = fixture();

		expect(await ev(f, '(memory/unalias "nothing")')).toBe("nil");
	});
});

describe("an alias outlives the session", () => {
	it("is reinstalled in a later interpreter", async () => {
		const dir = mkdtempSync(join(tmpdir(), "lisptc-alias-"));
		const store = new FileAliasStore(dir);

		const first = fixture(store);
		await ev(first, '(memory/alias "first" "car")');

		const second = fixture(new FileAliasStore(dir));
		await second.beginTurn();

		expect(await ev(second, "(first '(1 2 3))")).toBe("1");
	});

	it("is gone from a later interpreter once dropped", async () => {
		const dir = mkdtempSync(join(tmpdir(), "lisptc-alias-"));

		const first = fixture(new FileAliasStore(dir));
		await ev(first, '(memory/alias "first" "car")');
		await ev(first, '(memory/unalias "first")');

		const second = fixture(new FileAliasStore(dir));
		await second.beginTurn();

		await expect(ev(second, "(first '(1 2))")).rejects.toThrow();
	});

	it("keeps one entry per name when the same one is rewritten", async () => {
		const dir = mkdtempSync(join(tmpdir(), "lisptc-alias-"));

		const first = fixture(new FileAliasStore(dir));
		await ev(first, '(memory/alias "head" "car")');
		await ev(first, '(memory/alias "head" "cdr")');

		expect(new FileAliasStore(dir).all()).toEqual([
			{ name: "head", target: "cdr" },
		]);
	});
});
