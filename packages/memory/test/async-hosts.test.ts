import { driveAsync, driveSync, settled } from "@repo/interpreter/drive";
import { runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { describe, expect, it } from "vitest";
import { MemoryBank, memoryExtension } from "../src/memory.ts";
import {
	type MemoryRecord,
	type MemoryStore,
	type MemoryWrite,
	VolatileStore,
} from "../src/ports.ts";
import { bareHost, MemoryInterp } from "./helpers.ts";

class PromisedStore implements MemoryStore {
	private readonly inner = new VolatileStore();
	answered = 0;

	private later<T>(value: T): Promise<T> {
		this.answered += 1;
		return Promise.resolve().then(() => value);
	}

	all(): Promise<MemoryRecord[]> {
		return this.later(this.inner.all());
	}

	get(key: string): Promise<MemoryRecord | undefined> {
		return this.later(this.inner.get(key));
	}

	put(memory: MemoryWrite): Promise<void> {
		return this.later(this.inner.put(memory));
	}

	delete(key: string): Promise<boolean> {
		return this.later(this.inner.delete(key));
	}

	clear(): Promise<number> {
		return this.later(this.inner.clear());
	}
}

function interpWith(store: MemoryStore): MemoryInterp {
	const interp = new MemoryInterp({
		extensions: [
			memoryExtension(
				{ ...bareHost, store, prompt: () => "" },
				{
					bank: new MemoryBank(store),
				},
			),
		],
	});
	runSync(interp, prelude);
	return interp;
}

describe("settled", () => {
	it("hands back a plain value without suspending", () => {
		expect(driveSync(settled(7))).toBe(7);
	});

	it("suspends on a promise and resumes with what it resolved to", async () => {
		expect((await driveAsync(settled(Promise.resolve(7)))).value).toBe(7);
	});
});

describe("a memory store that answers with promises", () => {
	it("stores and recalls through an async driver", async () => {
		const store = new PromisedStore();
		const interp = interpWith(store);

		await runAsync(
			interp,
			'(memory/remember "port" "hosts declare what they need" :when "the test asks for it")',
		);
		const recalled = await runAsync(interp, '(memory/recall "port")');

		expect(str(recalled.value)).toContain("hosts declare what they need");
		expect(store.answered).toBeGreaterThan(0);
	});

	it("forgets and lists through the same surface", async () => {
		const store = new PromisedStore();
		const interp = interpWith(store);

		await runAsync(
			interp,
			'(memory/remember "k" "v" :when "the test asks for it")',
		);
		expect(str((await runAsync(interp, "(memories)")).value)).toContain("k");
		expect(str((await runAsync(interp, '(memory/forget "k")')).value)).toBe(
			"t",
		);
		expect(str((await runAsync(interp, "(memories)")).value)).toBe("nil");
	});

	it("refuses to run under a synchronous driver rather than half-storing", () => {
		expect(() =>
			runSync(
				interpWith(new PromisedStore()),
				'(memory/remember "k" "v" :when "the test asks for it")',
			),
		).toThrow(/cannot suspend/);
	});
});

describe("built-ins loading on the first message, over a store that answers with promises", () => {
	it("evaluates a body built with format without suspending the loader, when memories are already stored", async () => {
		const store = new PromisedStore();
		const builtin = Object.assign(() => {}, {
			prompt: "",
			memories:
				'(memory "internal/t/formatted" :when "the test asks for it" (format nil "~d steps" 3))',
		});
		const fresh = () => {
			const bank = new MemoryBank(store);
			const interp = new MemoryInterp({
				extensions: [
					memoryExtension({ ...bareHost, store, prompt: () => "" }, { bank }),
					builtin,
				],
			});
			runSync(interp, prelude);
			return { bank, interp };
		};
		await runAsync(
			fresh().interp,
			'(memory/remember "billing" "invoices live in stripe" :when "user asks about billing")',
		);
		const { bank, interp } = fresh();
		interp.seed([{ role: "user", content: "hello" }]);

		await driveAsync(bank.hear(interp));

		expect(bank.builtins().get("internal/t/formatted")?.body).toBe("3 steps");
	});
});

describe("a synchronous store still runs synchronously", () => {
	it("takes the whole memory surface under runSync", () => {
		const interp = interpWith(new VolatileStore());

		runSync(
			interp,
			'(memory/remember "k" "a note" :when "the test asks for it")',
		);

		expect(str(runSync(interp, '(memory/recall "k")'))).toContain("a note");
		expect(str(runSync(interp, '(memory/forget "k")'))).toBe("t");
	});
});
