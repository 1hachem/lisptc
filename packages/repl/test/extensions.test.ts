import { Compactor, compactionExtension } from "@repo/interpreter/compaction";
import { proseExtension } from "@repo/interpreter/prose";
import { EnvSecretsStore, secretsExtension } from "@repo/interpreter/secrets";
import { type LlmCall, llmExtension } from "@repo/llm/llm";
import { describe, expect, it } from "vitest";
import { modelFacingExtensions } from "../src/extensions.ts";
import { MemoryRepl } from "../src/repl.ts";

describe("a REPL built from the default roster", () => {
	it("speaks the whole model-facing language", async () => {
		const r = new MemoryRepl();

		expect(await r.eval("(+ 1 2)")).toBe("+-1: 3\n");
		expect(await r.eval("(list-toolkit)")).toContain("playwright");
		expect(r.secrets).toBeDefined();
		expect(await r.eval("(doc 'llm/complete)")).toContain("(llm/complete");
	});
});

describe("a REPL built from a roster of its own", () => {
	it("gets exactly the extensions it was handed", async () => {
		const r = new MemoryRepl({
			extensions: [compactionExtension(new Compactor(4)), proseExtension()],
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
		const store = new EnvSecretsStore();
		store.set({ REPL_SHARED: { value: "s", description: "shared" } });
		const r = new MemoryRepl({
			extensions: modelFacingExtensions({
				secrets: secretsExtension({ store }),
			}),
		});

		expect(r.secrets).toBe(store);
		expect(await r.eval("(secrets)")).toContain("shared");
	});

	it("points the llm observer at the llm extension it carries", async () => {
		const calls: LlmCall[] = [];
		const r = new MemoryRepl({
			extensions: modelFacingExtensions({
				llm: llmExtension({
					generate: async () => ({ text: "pong", provider: "x", model: "y" }),
				}),
			}),
		});
		r.llmObserver = (call) => calls.push(call);

		await r.eval('(llm/complete "ping")');
		r.reset();
		await r.eval('(llm/complete "ping")');

		expect(calls.map((call) => call.output)).toEqual(["pong", "pong"]);
	});
});
