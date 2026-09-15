import { Compactor, compactionExtension } from "@repo/interpreter/compaction";
import { compactionHost } from "@repo/interpreter/compaction-host";
import {
	MemoryBank,
	memoryExtension,
	VolatileStore,
} from "@repo/interpreter/memory";
import { memoryHost } from "@repo/interpreter/memory-host";
import { proseExtension } from "@repo/interpreter/prose";
import { secretsExtension } from "@repo/interpreter/secrets";
import { envSecretsStore, secretsHost } from "@repo/interpreter/secrets-host";
import { type LlmCall, llmExtension } from "@repo/llm/llm";
import { llmHost } from "@repo/llm/llm-host";
import { describe, expect, it } from "vitest";
import { MemoryRepl } from "../src/repl.ts";
import { memoryRepl } from "./helpers.ts";

describe("a REPL built from the model-facing list", () => {
	it("speaks the whole model-facing language", async () => {
		const r = memoryRepl();

		expect(await r.eval("(+ 1 2)")).toBe("+-1: 3\n");
		expect(await r.eval("(list-toolkit)")).toContain("playwright");
		expect(r.secrets).toBeDefined();
		expect(await r.eval("(doc 'llm/complete)")).toContain("(llm/complete");
	});
});

describe("a REPL built from a list of its own", () => {
	it("gets exactly the extensions it was handed", async () => {
		const r = new MemoryRepl({
			extensions: [
				compactionExtension(compactionHost, { compactor: new Compactor(4) }),
				proseExtension(),
			],
		});

		expect(r.secrets).toBeUndefined();
		expect(await r.eval('(secret "REPL_X")')).toContain("undefined");
		expect(await r.eval('(echo "a b c d e f")')).toContain("4 of 6 words");
	});

	it("reports uncapped when no compaction extension is in it", async () => {
		const r = new MemoryRepl({ extensions: [proseExtension()] });

		const { model, user } = await r.evalOutput('(echo "a b c")');
		expect(user).toBe("a b c\n");
		expect(model).toBe("");
	});

	it("takes the secrets store from the extension that was configured", async () => {
		const store = envSecretsStore();
		store.set({ REPL_SHARED: { value: "s", description: "shared" } });
		const r = memoryRepl([
			secretsExtension({ ...secretsHost, store }),
			compactionExtension(),
		]);

		expect(r.secrets).toBe(store);
		expect(await r.eval("(secrets)")).toContain("shared");
	});

	it("takes the memory bank from the extension that was configured", async () => {
		const bank = new MemoryBank(new VolatileStore());
		const r = memoryRepl([
			compactionExtension(),
			memoryExtension(memoryHost, { bank }),
		]);

		expect(r.memories).toBe(bank);
		await r.eval('(memory/remember "k" "a note worth keeping")');

		expect(bank.store.get("k")?.body).toBe("a note worth keeping");
	});

	it("hands a fired memory back on its own lane, not in the REPL output", async () => {
		const bank = new MemoryBank(new VolatileStore());
		const r = memoryRepl([
			compactionExtension(),
			memoryExtension(memoryHost, { bank }),
		]);
		await r.eval(`(memory/remember "k" "the note" :on '(step))`);

		const { model, memories } = await r.evalOutput("(+ 1 1)");

		expect(memories).toEqual([{ key: "k", body: "the note" }]);
		expect(model).not.toContain("the note");
		expect(model).toContain("2");
	});

	it("reports no memories on a step that fired none", async () => {
		const r = memoryRepl([
			compactionExtension(),
			memoryExtension(memoryHost, {
				bank: new MemoryBank(new VolatileStore()),
			}),
		]);

		expect((await r.evalOutput("(+ 1 1)")).memories).toEqual([]);
	});

	it("has no bank when no memory extension is in it", () => {
		expect(memoryRepl([compactionExtension()]).memories).toBeUndefined();
	});

	it("points the llm observer at the llm extension it carries", async () => {
		const calls: LlmCall[] = [];
		const r = memoryRepl([
			llmExtension({
				...llmHost,
				generate: async () => ({ text: "pong", provider: "x", model: "y" }),
			}),
		]);
		r.llmObserver = (call) => calls.push(call);

		await r.eval('(llm/complete "ping")');
		r.reset();
		await r.eval('(llm/complete "ping")');

		expect(calls.map((call) => call.output)).toEqual(["pong", "pong"]);
	});
});
