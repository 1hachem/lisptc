import { Compactor, compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { llmSlot } from "@repo/interpreter/observe";
import {
	MemoryBank,
	memoryExtension,
	memorySlot,
} from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { VolatileStore } from "@repo/memory-extension/ports";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { MemoryRepl } from "@repo/repl/repl";
import { secretsExtension, secretsSlot } from "@repo/secrets-extension";
import { envSecretsStore, secretsHost } from "@repo/secrets-extension/host";
import { describe, expect, it } from "vitest";
import { memoryRepl } from "./helpers.ts";

describe("a REPL built from a list of extensions", () => {
	it("speaks the language every one of them contributed to", async () => {
		const r = memoryRepl();

		expect(await r.eval("(+ 1 2)")).toBe("+-1: 3\n");
		expect(await r.eval('(memory/remember "k" "a note")')).toContain("k");
		expect(r.hooks.filled(secretsSlot)).toBeDefined();
	});
});

describe("a REPL built from a list of its own", () => {
	it("gets exactly the extensions it was handed", async () => {
		const r = new MemoryRepl({
			extensions: [
				compactionExtension(compactionHost, { compactor: new Compactor(4) }),
				proseExtension(proseHost),
			],
		});

		expect(r.hooks.filled(secretsSlot)).toBeUndefined();
		expect(await r.eval('(secret "REPL_X")')).toContain("undefined");
		expect(await r.eval('(echo "a b c d e f")')).toContain("4 of 6 words");
	});

	it("reports uncapped when no compaction extension is in it", async () => {
		const r = new MemoryRepl({ extensions: [proseExtension(proseHost)] });

		const { model, user } = await r.evalOutput('(echo "a b c")');
		expect(user).toBe("a b c\n");
		expect(model).toBe("");
	});

	it("takes the secrets store from the extension that was configured", async () => {
		const store = envSecretsStore();
		store.set({ REPL_SHARED: { value: "s", description: "shared" } });
		const r = memoryRepl([
			secretsExtension({ ...secretsHost, store }),
			compactionExtension(compactionHost),
		]);

		expect(r.hooks.filled(secretsSlot)).toBe(store);
		expect(await r.eval("(secrets)")).toContain("shared");
	});

	it("takes the memory bank from the extension that was configured", async () => {
		const bank = new MemoryBank(new VolatileStore());
		const r = memoryRepl([
			compactionExtension(compactionHost),
			memoryExtension(memoryHost, { bank }),
		]);

		expect(r.hooks.filled(memorySlot)).toBe(bank);
		await r.eval('(memory/remember "k" "a note worth keeping")');

		expect((await bank.store.get("k"))?.body).toBe("a note worth keeping");
	});

	it("hands a fired memory back on its own lane, not in the REPL output", async () => {
		const bank = new MemoryBank(new VolatileStore());
		const r = memoryRepl([
			compactionExtension(compactionHost),
			memoryExtension(memoryHost, { bank }),
		]);
		await r.eval(`(memory/remember "k" "the note" :on '(step))`);

		const { model, annotations } = await r.evalOutput("(+ 1 1)");

		expect(annotations.step.memories).toEqual([{ key: "k", body: "the note" }]);
		expect(model).not.toContain("the note");
		expect(model).toContain("2");
	});

	it("reports no memories on a step that fired none", async () => {
		const r = memoryRepl([
			compactionExtension(compactionHost),
			memoryExtension(memoryHost, {
				bank: new MemoryBank(new VolatileStore()),
			}),
		]);

		expect((await r.evalOutput("(+ 1 1)")).annotations.step).not.toHaveProperty(
			"memories",
		);
	});

	it("has no bank when no memory extension is in it", () => {
		expect(
			memoryRepl([compactionExtension(compactionHost)]).hooks.filled(
				memorySlot,
			),
		).toBeUndefined();
	});

	it("has no observer to hand out when nothing fills the slot", () => {
		expect(
			memoryRepl([proseExtension(proseHost)]).hooks.filled(llmSlot),
		).toBeUndefined();
	});
});
