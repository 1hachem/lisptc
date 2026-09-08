import {
	EvalException,
	Interp,
	prelude,
	runAsync,
	runSync,
	str,
} from "@repo/interpreter/lisp";
import { describe, expect, it } from "vitest";
import {
	type Generate,
	type LlmCall,
	type LlmRequest,
	type LlmResult,
	llmExtension,
} from "../src/llm.ts";

type Reply = (req: LlmRequest) => LlmResult | string;

const PROVIDERS = [
	{ name: "digitalocean", model: "gemma-4-31B-it", ready: true },
	{ name: "llamacpp", model: "gemma-4-E4B-it", ready: false },
];

function llmInterp(reply: Reply = () => "ok") {
	const seen: LlmRequest[] = [];
	const traced: LlmCall[] = [];
	const generate: Generate = async (req) => {
		seen.push(req);
		const answer = reply(req);
		return typeof answer === "string" ? { text: answer } : answer;
	};
	const interp = new Interp({
		extensions: [
			llmExtension({
				generate,
				providers: () => PROVIDERS,
				observe: (call) => traced.push(call),
			}),
		],
	});
	runSync(interp, prelude);
	return { interp, seen, traced };
}

async function evalStr(interp: Interp, code: string): Promise<string> {
	return str((await runAsync(interp, code)).value);
}

async function failure(interp: Interp, code: string): Promise<string> {
	try {
		await runAsync(interp, code);
	} catch (ex) {
		return ex instanceof EvalException ? ex.message : String(ex);
	}
	throw new Error("expected a failure");
}

describe("llm/complete", () => {
	it("returns the reply as a string", async () => {
		const { interp, seen } = llmInterp(() => "hello there");
		expect(await evalStr(interp, '(llm/complete "greet me")')).toBe(
			'"hello there"',
		);
		expect(seen).toEqual([
			{ messages: [{ role: "user", content: "greet me" }] },
		]);
	});

	it("passes the options through to the request", async () => {
		const { interp, seen } = llmInterp();
		await runAsync(
			interp,
			`(llm/complete "explain monads"
			   :system "You are a Haskell expert."
			   :provider :openrouter
			   :model "google/gemma-4-31b-it"
			   :max-tokens 200
			   :temperature 0.3
			   :reasoning-effort :high)`,
		);
		expect(seen[0]).toEqual({
			messages: [
				{ role: "system", content: "You are a Haskell expert." },
				{ role: "user", content: "explain monads" },
			],
			provider: "openrouter",
			model: "google/gemma-4-31b-it",
			maxTokens: 200,
			temperature: 0.3,
			reasoningEffort: "high",
		});
	});

	it("rejects an unknown option and a prompt that is not a value", async () => {
		const { interp } = llmInterp();
		expect(await failure(interp, '(llm/complete "hi" :temp 0.2)')).toContain(
			"unknown option",
		);
		expect(await failure(interp, "(llm/complete (lambda (x) x))")).toContain(
			"the prompt must be a string or Lisp data",
		);
	});

	it("reports a timeout instead of hanging", async () => {
		const { interp } = llmInterp(() => {
			throw new Error("unreachable");
		});
		const stuck = new Interp({
			extensions: [
				llmExtension({
					generate: () => new Promise<LlmResult>(() => {}),
				}),
			],
		});
		runSync(stuck, prelude);
		expect(await failure(stuck, '(llm/complete "hi" :timeout 10)')).toContain(
			"llm timed out",
		);
		expect(interp).toBeDefined();
	});
});

describe("*llm-defaults* and with-llm", () => {
	it("starts every call from the defaults, with the call site winning", async () => {
		const { interp, seen } = llmInterp();
		await runAsync(
			interp,
			`(setq *llm-defaults* (list :provider :llamacpp :max-tokens 50))
			 (llm/complete "one")
			 (llm/complete "two" :max-tokens 500)`,
		);
		expect(seen[0].provider).toBe("llamacpp");
		expect(seen[0].maxTokens).toBe(50);
		expect(seen[1].maxTokens).toBe(500);
	});

	it("binds the defaults for one block and restores them after", async () => {
		const { interp, seen } = llmInterp();
		expect(
			await evalStr(
				interp,
				`(with-llm (:provider :openrouter :max-tokens 20)
				   (llm/complete "inside"))`,
			),
		).toBe('"ok"');
		expect(seen[0].provider).toBe("openrouter");
		expect(await evalStr(interp, "(identity *llm-defaults*)")).toBe("nil");
	});

	it("restores the defaults when the body raises", async () => {
		const { interp } = llmInterp();
		expect(
			await evalStr(
				interp,
				`(try (with-llm (:provider :openrouter) (error "boom"))
				      (catch (e) e))`,
			),
		).toBe('"boom"');
		expect(await evalStr(interp, "(identity *llm-defaults*)")).toBe("nil");
	});

	it("rejects a malformed default list", async () => {
		const { interp } = llmInterp();
		expect(
			await failure(
				interp,
				'(progn (setq *llm-defaults* (list :nonsense 1)) (llm/complete "hi"))',
			),
		).toContain("unknown option");
	});
});

describe("llm/chat", () => {
	it("sends messages built with message, and bare strings as user turns", async () => {
		const { interp, seen } = llmInterp(() => "a dialect of Lisp");
		expect(
			await evalStr(
				interp,
				`(llm/chat (list (message :system "Be terse.")
				                 (message :user "What is lisptc?")
				                 "one sentence"))`,
			),
		).toBe('"a dialect of Lisp"');
		expect(seen[0].messages).toEqual([
			{ role: "system", content: "Be terse." },
			{ role: "user", content: "What is lisptc?" },
			{ role: "user", content: "one sentence" },
		]);
	});

	it("accepts the conversation shape unchanged", async () => {
		const { interp, seen } = llmInterp();
		await runAsync(
			interp,
			`(llm/chat (list (list (cons "role" "user") (cons "content" "hi"))))`,
		);
		expect(seen[0].messages).toEqual([{ role: "user", content: "hi" }]);
	});

	it("rejects an unknown role and a message with no content", async () => {
		const { interp } = llmInterp();
		expect(
			await failure(interp, '(llm/chat (list (message :bot "hi")))'),
		).toContain("unknown role");
		expect(
			await failure(interp, '(llm/chat (list (list (cons "role" "user"))))'),
		).toContain('needs both "role" and "content"');
	});
});

describe("llm/extract", () => {
	it("turns a shape into a json schema and the answer into an alist", async () => {
		const { interp, seen } = llmInterp(() => ({
			text: "{}",
			value: { name: "Ada Lovelace", born: 1815, tags: ["maths"] },
		}));
		expect(
			await evalStr(
				interp,
				`(llm/extract "Ada Lovelace, born 1815, wrote about maths"
				   (list (cons "name" "the person's full name")
				         (cons "born" :integer)
				         (cons "tags" (list :list :string))
				         (cons "nickname" (list :optional :string))))`,
			),
		).toBe('(("name" . "Ada Lovelace") ("born" . 1815.0) ("tags" "maths"))');
		expect(seen[0].schema).toEqual({
			name: "extraction",
			schema: {
				type: "object",
				additionalProperties: false,
				required: ["name", "born", "tags"],
				properties: {
					name: { type: "string", description: "the person's full name" },
					born: { type: "integer" },
					tags: { type: "array", items: { type: "string" } },
					nickname: { type: "string" },
				},
			},
		});
	});

	it("wraps and unwraps a top-level list shape", async () => {
		const { interp, seen } = llmInterp(() => ({
			text: "{}",
			value: { value: ["one", "two"] },
		}));
		expect(
			await evalStr(
				interp,
				'(llm/extract "one and two" (list :list :string) :instructions "the words")',
			),
		).toBe('("one" "two")');
		expect(seen[0].schema?.schema).toEqual({
			type: "object",
			additionalProperties: false,
			required: ["value"],
			properties: { value: { type: "array", items: { type: "string" } } },
		});
		expect(seen[0].messages[1].content).toBe("the words\n\none and two");
		expect(seen[0].messages[0].role).toBe("system");
	});

	it("supports enums and nested objects", async () => {
		const { interp, seen } = llmInterp(() => ({ text: "{}", value: {} }));
		await runAsync(
			interp,
			`(llm/extract "an issue"
			   (list (cons "state" (list :enum "open" "closed"))
			         (cons "author" (list (cons "name" :string)))))`,
		);
		expect(seen[0].schema?.schema).toMatchObject({
			properties: {
				state: { type: "string", enum: ["open", "closed"] },
				author: {
					type: "object",
					properties: { name: { type: "string" } },
					required: ["name"],
				},
			},
		});
	});

	it("rejects an unknown field type", async () => {
		const { interp } = llmInterp();
		expect(
			await failure(interp, '(llm/extract "x" (list (cons "a" :date)))'),
		).toContain("unknown field type");
	});
});

describe("the shape macro", () => {
	it("builds the extraction alist without quoting or dotted pairs", async () => {
		const { interp, seen } = llmInterp(() => ({ text: "{}", value: {} }));
		await runAsync(
			interp,
			`(llm/extract "an issue"
			   (shape (title "the issue title")
			          (stars :integer)
			          (state (:enum "open" "closed"))
			          (links (:list :string))
			          (author (:optional :string))))`,
		);
		expect(seen[0].schema?.schema).toEqual({
			type: "object",
			additionalProperties: false,
			required: ["title", "stars", "state", "links"],
			properties: {
				title: { type: "string", description: "the issue title" },
				stars: { type: "integer" },
				state: { type: "string", enum: ["open", "closed"] },
				links: { type: "array", items: { type: "string" } },
				author: { type: "string" },
			},
		});
	});

	it("reads a nested group as an object, inside a :list too", async () => {
		const { interp, seen } = llmInterp(() => ({ text: "{}", value: {} }));
		await runAsync(
			interp,
			`(llm/extract "issues"
			   (shape (owner (name :string) (email (:optional :string)))
			          (items (:list (id :number) (title :string)))))`,
		);
		expect(seen[0].schema?.schema).toMatchObject({
			properties: {
				owner: {
					type: "object",
					properties: { name: { type: "string" }, email: { type: "string" } },
					required: ["name"],
				},
				items: {
					type: "array",
					items: {
						type: "object",
						properties: { id: { type: "number" }, title: { type: "string" } },
						required: ["id", "title"],
					},
				},
			},
		});
	});

	it("expands to a literal alist, keeping a string key as written", async () => {
		const { interp } = llmInterp();
		expect(await evalStr(interp, '(shape ("issue title" :string))')).toBe(
			'(("issue title" . :string))',
		);
		expect(await failure(interp, "(shape)")).toContain(
			"shape needs at least one field",
		);
	});
});

describe("a value that is not a string", () => {
	it("goes into the prompt as its printed form", async () => {
		const { interp, seen } = llmInterp();
		await runAsync(
			interp,
			'(llm/complete (list (cons "id" 1) (cons "title" "auth bug")))',
		);
		expect(seen[0].messages[0].content).toBe(
			'(("id" . 1) ("title" . "auth bug"))',
		);
	});

	it("works for a message content, a :system and the text to read", async () => {
		const { interp, seen } = llmInterp(() => ({ text: "{}", value: {} }));
		await runAsync(interp, "(llm/chat (list (message :user (list 1 2))))");
		expect(seen[0].messages[0].content).toBe("(1 2)");
		await runAsync(
			interp,
			'(llm/extract (list "a" "b") (shape (n :integer)) :system (list :terse))',
		);
		expect(seen[1].messages[0].content).toBe("(:terse)");
		expect(seen[1].messages[1].content).toBe('("a" "b")');
	});

	it("still refuses nil, so a missing value is not sent as text", async () => {
		const { interp } = llmInterp();
		expect(await failure(interp, "(llm/complete nil)")).toContain(
			"the prompt must not be nil",
		);
	});
});

describe("the summarization macros", () => {
	it("asks for a summary of the value's printed form", async () => {
		const { interp, seen } = llmInterp(() => "a short summary");
		expect(
			await evalStr(
				interp,
				"(progn (setq rows (list 1 2 3)) (summarize rows :words 10))",
			),
		).toBe('"a short summary"');
		expect(seen[0].messages[0].content).toBe(
			"Summarize the input below in about 10 words. Keep the names, numbers and conclusions. Write the summary only.\n\n(1 2 3)",
		);
		expect(seen[0].maxTokens).toBe(40);
	});

	it("passes its other options on, and lets :max-tokens win", async () => {
		const { interp, seen } = llmInterp();
		await runAsync(
			interp,
			'(summarize "text" :words 30 :max-tokens 15 :provider :llamacpp)',
		);
		expect(seen[0].maxTokens).toBe(15);
		expect(seen[0].provider).toBe("llamacpp");
	});

	it("summarizes every element of a list, in order", async () => {
		const { interp, seen } = llmInterp((req) =>
			req.messages[0].content.includes("alpha") ? "first" : "second",
		);
		expect(
			await evalStr(interp, '(summarize-each (list "alpha" "beta"))'),
		).toBe('("first" "second")');
		expect(seen).toHaveLength(2);
		expect(seen[0].maxTokens).toBe(100);
	});

	it("takes its provider from with-llm", async () => {
		const { interp, seen } = llmInterp();
		await runAsync(
			interp,
			'(with-llm (:provider :openrouter) (summarize-each (list "a")))',
		);
		expect(seen[0].provider).toBe("openrouter");
	});
});

describe("llm/answer", () => {
	it("asks the question against the context, and only the context", async () => {
		const { interp, seen } = llmInterp(() => "Ada Lovelace");
		expect(
			await evalStr(
				interp,
				`(progn (setq page "Ada Lovelace wrote the first algorithm.")
				        (llm/answer "Who wrote it?" page))`,
			),
		).toBe('"Ada Lovelace"');
		expect(seen[0].messages[1].content).toBe(
			"Context:\nAda Lovelace wrote the first algorithm.\n\nQuestion: Who wrote it?",
		);
		expect(seen[0].messages[0].role).toBe("system");
		expect(seen[0].messages[0].content).toContain("from the context alone");
		expect(seen[0].messages[0].content).toContain("at most 60 words");
		expect(seen[0].maxTokens).toBe(240);
	});

	it("returns nil when the context does not answer it", async () => {
		const { interp } = llmInterp(() => "NOT-IN-CONTEXT");
		expect(await evalStr(interp, '(llm/answer "When?" "no dates here")')).toBe(
			"nil",
		);
	});

	it("still returns nil when the model punctuates the sentinel", async () => {
		const { interp } = llmInterp(() => "NOT-IN-CONTEXT.");
		expect(await evalStr(interp, '(llm/answer "When?" "no dates")')).toBe(
			"nil",
		);
	});

	it("reads a list of records as its context", async () => {
		const { interp, seen } = llmInterp(() => "ENG-12");
		await runAsync(
			interp,
			`(llm/answer "Which issue mentions auth?"
			             (list (cons "id" "ENG-12") (cons "title" "auth token")))`,
		);
		expect(seen[0].messages[1].content).toContain(
			'(("id" . "ENG-12") ("title" . "auth token"))',
		);
	});

	it("passes its other options on, with :words setting the budget", async () => {
		const { interp, seen } = llmInterp();
		await runAsync(
			interp,
			'(llm/answer "q" "ctx" :words 10 :provider :llamacpp :temperature 0.0)',
		);
		expect(seen[0].messages[0].content).toContain("at most 10 words");
		expect(seen[0]).toMatchObject({
			provider: "llamacpp",
			temperature: 0,
			maxTokens: 40,
		});
	});

	it("traces as the built-in that ran it", async () => {
		const { interp, traced } = llmInterp();
		await runAsync(interp, '(llm/answer "q" "ctx")');
		expect(traced.map((call) => call.builtin)).toEqual(["llm/complete"]);
	});
});

describe("llm/providers", () => {
	it("reports each provider, its default model and whether it is usable", async () => {
		const { interp } = llmInterp();
		expect(await evalStr(interp, "(llm/providers)")).toBe(
			'((:digitalocean "gemma-4-31B-it" :ready) (:llamacpp "gemma-4-E4B-it" :no-api-key))',
		);
	});
});

describe("documentation", () => {
	it("documents every binding the extension adds", async () => {
		const { interp } = llmInterp();
		const docs = interp.docs();
		for (const name of [
			"llm/complete",
			"llm/chat",
			"llm/extract",
			"llm/providers",
			"message",
			"summarize",
			"summarize-each",
			"llm/answer",
			"with-llm",
			"*llm-defaults*",
		])
			expect(docs.has(name), name).toBe(true);
		const undocumented = interp
			.globalNames()
			.filter((name) => !name.startsWith("_") && !docs.has(name));
		expect(undocumented).toEqual([]);
	});
});

describe("the observer", () => {
	it("reports one call, with what answered it and what it cost", async () => {
		const { interp, traced } = llmInterp(() => ({
			text: "hello there",
			provider: "llamacpp",
			model: "a-small-one",
			inputTokens: 11,
			outputTokens: 7,
		}));
		await runAsync(interp, '(llm/complete "greet me" :max-tokens 20)');
		expect(traced).toHaveLength(1);
		expect(traced[0]).toMatchObject({
			builtin: "llm/complete",
			provider: "llamacpp",
			model: "a-small-one",
			messages: [{ role: "user", content: "greet me" }],
			structured: false,
			output: "hello there",
			inputTokens: 11,
			outputTokens: 7,
		});
		expect(traced[0].latencyMs).toBeGreaterThanOrEqual(0);
		expect(traced[0].error).toBeUndefined();
	});

	it("names the built-in that made the call, and marks a constrained one", async () => {
		const { interp, traced } = llmInterp(() => ({ text: "{}", value: {} }));
		await runAsync(
			interp,
			`(progn (llm/chat (list (message :user "hi")))
			        (llm/extract "x" (list (cons "a" :string))))`,
		);
		expect(traced.map((call) => [call.builtin, call.structured])).toEqual([
			["llm/chat", false],
			["llm/extract", true],
		]);
	});

	it("reports a failed call too, with the reason", async () => {
		const failed: LlmCall[] = [];
		const interp = new Interp({
			extensions: [
				llmExtension({
					generate: () => Promise.reject(new Error("upstream is down")),
					observe: (call) => {
						failed.push(call);
					},
				}),
			],
		});
		runSync(interp, prelude);
		await expect(runAsync(interp, '(llm/complete "hi")')).rejects.toThrow(
			/upstream is down/,
		);
		expect(failed).toHaveLength(1);
		expect(failed[0]).toMatchObject({
			builtin: "llm/complete",
			error: "upstream is down",
		});
		expect(failed[0].output).toBeUndefined();
	});

	it("never lets a broken observer break the call", async () => {
		const interp = new Interp({
			extensions: [
				llmExtension({
					generate: async () => ({ text: "fine" }),
					observe: () => {
						throw new Error("observer exploded");
					},
				}),
			],
		});
		runSync(interp, prelude);
		expect(str((await runAsync(interp, '(llm/complete "hi")')).value)).toBe(
			'"fine"',
		);
	});
});
