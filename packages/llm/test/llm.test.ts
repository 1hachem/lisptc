import { EvalException } from "@repo/interpreter/errors";
import { boot, Interp, runAsync } from "@repo/interpreter/lisp";
import type { LlmCall } from "@repo/interpreter/observe";
import { str } from "@repo/interpreter/print";
import { describe, expect, it } from "vitest";
import {
	type Generate,
	type LlmRequest,
	type LlmResult,
	llmExtension,
} from "../src/llm.ts";
import { llmHost } from "../src/llm-host.ts";

type Reply = (req: LlmRequest) => LlmResult | string;

const transcript = (req: LlmRequest): string =>
	req.messages.map((m) => `${m.role}: ${m.content}`).join(" | ");

const settings = (req: LlmRequest): string =>
	[
		req.provider ?? "default",
		req.model,
		req.maxTokens,
		req.temperature,
		req.reasoningEffort,
	]
		.filter((v) => v !== undefined)
		.join(" ");

function seesInOrder(...parts: string[]): Reply {
	return (req) => {
		const all = req.messages.map((m) => m.content).join("\n");
		let at = -1;
		for (const part of parts) {
			at = all.indexOf(part, at + 1);
			if (at < 0) return "unseen";
		}
		return "seen";
	};
}

type Json = Record<string, unknown>;

function sample(schema: Json): unknown {
	if (Array.isArray(schema.enum)) return schema.enum[0];
	switch (schema.type) {
		case "object": {
			const properties = schema.properties as Record<string, Json>;
			const required = schema.required as string[];
			return Object.fromEntries(
				required.map((key) => [key, sample(properties[key])]),
			);
		}
		case "array":
			return [sample(schema.items as Json)];
		case "integer":
		case "number":
			return 7;
		default:
			return schema.description ?? "text";
	}
}

const obeying: Reply = (req) => ({
	text: "{}",
	value: req.schema === undefined ? {} : sample(req.schema.schema),
});

function llmInterp(reply: Reply = () => "ok") {
	const traced: LlmCall[] = [];
	const generate: Generate = async (req) => {
		const answer = reply(req);
		return typeof answer === "string" ? { text: answer } : answer;
	};
	const interp = new Interp({
		extensions: [
			llmExtension(
				{ ...llmHost, generate },
				{ observe: (call) => traced.push(call) },
			),
		],
	});
	boot(interp);
	return { interp, traced };
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

describe("write", () => {
	it("sends the prompt as a user turn and returns the reply as a string", async () => {
		const { interp } = llmInterp(transcript);
		expect(await evalStr(interp, '(write "greet me")')).toBe(
			'"user: greet me"',
		);
	});

	it("sends a :system turn ahead of the prompt, with the settings it was given", async () => {
		const { interp } = llmInterp(
			(req) => `${transcript(req)} | ${settings(req)}`,
		);
		expect(
			await evalStr(
				interp,
				`(write "explain monads"
				   :system "You are a Haskell expert."
				   :provider :openrouter
				   :model "google/gemma-4-31b-it"
				   :max-tokens 200
				   :temperature 0.3
				   :reasoning-effort :high)`,
			),
		).toBe(
			'"system: You are a Haskell expert. | user: explain monads | openrouter google/gemma-4-31b-it 200 0.3 high"',
		);
	});

	it("rejects an unknown option and a prompt that is not a value", async () => {
		const { interp } = llmInterp();
		expect(await failure(interp, '(write "hi" :temp 0.2)')).toContain(
			"unknown option",
		);
		expect(await failure(interp, "(write (lambda (x) x))")).toContain(
			"the prompt must be a string or Lisp data",
		);
	});

	it("reports a timeout instead of hanging", async () => {
		const stuck = new Interp({
			extensions: [
				llmExtension({
					...llmHost,
					generate: () => new Promise<LlmResult>(() => {}),
				}),
			],
		});
		boot(stuck);
		expect(await failure(stuck, '(write "hi" :timeout 10)')).toContain(
			"write timed out",
		);
	});
});

describe("*writing-defaults* and with-writing", () => {
	it("starts every call from the defaults, with the call site winning", async () => {
		const { interp } = llmInterp(settings);
		expect(
			await evalStr(
				interp,
				`(setq *writing-defaults* (list :provider :openrouter :max-tokens 50))
				 (list (write "one") (write "two" :max-tokens 500))`,
			),
		).toBe('("openrouter 50" "openrouter 500")');
	});

	it("binds the defaults for one block and restores them after", async () => {
		const { interp } = llmInterp(settings);
		expect(
			await evalStr(
				interp,
				`(list (with-writing (:provider :openrouter :max-tokens 20)
				         (write "inside"))
				       (write "outside")
				       *writing-defaults*)`,
			),
		).toBe('("openrouter 20" "default" nil)');
	});

	it("restores the defaults when the body raises", async () => {
		const { interp } = llmInterp();
		expect(
			await evalStr(
				interp,
				`(try (with-writing (:provider :openrouter) (error "boom"))
				      (catch (e) e))`,
			),
		).toBe('"boom"');
		expect(await evalStr(interp, "(identity *writing-defaults*)")).toBe("nil");
	});

	it("rejects a malformed default list", async () => {
		const { interp } = llmInterp();
		expect(
			await failure(
				interp,
				'(progn (setq *writing-defaults* (list :nonsense 1)) (write "hi"))',
			),
		).toContain("unknown option");
	});
});

describe("converse", () => {
	it("sends messages built with message, and bare strings as user turns", async () => {
		const { interp } = llmInterp(transcript);
		expect(
			await evalStr(
				interp,
				`(converse (list (message :system "Be terse.")
				                 (message :user "What is lisptc?")
				                 "one sentence"))`,
			),
		).toBe('"system: Be terse. | user: What is lisptc? | user: one sentence"');
	});

	it("rejects an unknown role and a message with no content", async () => {
		const { interp } = llmInterp();
		expect(
			await failure(interp, '(converse (list (message :bot "hi")))'),
		).toContain("unknown role");
		expect(
			await failure(interp, '(converse (list (list (cons "role" "user"))))'),
		).toContain('needs both "role" and "content"');
	});
});

describe("extract", () => {
	it("returns the answer to its shape as an alist, leaving out an optional field", async () => {
		const { interp } = llmInterp(obeying);
		expect(
			await evalStr(
				interp,
				`(extract "Ada Lovelace, born 1815, wrote about maths"
				   (list (cons "name" "the person's full name")
				         (cons "born" :integer)
				         (cons "tags" (list :list :string))
				         (cons "nickname" (list :optional :string))))`,
			),
		).toBe(
			`(("name" . "the person's full name") ("born" . 7.0) ("tags" "text"))`,
		);
	});

	it("returns a top-level list shape as a bare list", async () => {
		const { interp } = llmInterp(obeying);
		expect(
			await evalStr(
				interp,
				'(extract "one and two" (list :list :string) :instructions "the words")',
			),
		).toBe('("text")');
	});

	it("answers an enum with one of its values and a nested shape as a nested alist", async () => {
		const { interp } = llmInterp(obeying);
		expect(
			await evalStr(
				interp,
				`(extract "an issue"
				   (list (cons "state" (list :enum "open" "closed"))
				         (cons "author" (list (cons "name" :string)))))`,
			),
		).toBe('(("state" . "open") ("author" ("name" . "text")))');
	});

	it("rejects an unknown field type", async () => {
		const { interp } = llmInterp();
		expect(
			await failure(interp, '(extract "x" (list (cons "a" :date)))'),
		).toContain("unknown field type");
	});
});

describe("the shape macro", () => {
	it("describes every field kind without quoting or dotted pairs", async () => {
		const { interp } = llmInterp(obeying);
		expect(
			await evalStr(
				interp,
				`(extract "an issue"
				   (shape (title "the issue title")
				          (stars :integer)
				          (state (:enum "open" "closed"))
				          (links (:list :string))
				          (author (:optional :string))))`,
			),
		).toBe(
			'(("title" . "the issue title") ("stars" . 7.0) ("state" . "open") ("links" "text"))',
		);
	});

	it("reads a nested group as an object, inside a :list too", async () => {
		const { interp } = llmInterp(obeying);
		expect(
			await evalStr(
				interp,
				`(extract "issues"
				   (shape (owner (name :string) (email (:optional :string)))
				          (items (:list (id :number) (title :string)))))`,
			),
		).toBe(
			'(("owner" ("name" . "text")) ("items" (("id" . 7.0) ("title" . "text"))))',
		);
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
		const { interp } = llmInterp(transcript);
		expect(
			await evalStr(
				interp,
				'(write (list (cons "id" 1) (cons "title" "auth bug")))',
			),
		).toBe(String.raw`"user: ((\"id\" . 1) (\"title\" . \"auth bug\"))"`);
	});

	it("works for a message content, a :system and the text to read", async () => {
		const { interp } = llmInterp((req) => ({
			text: transcript(req),
			value: { heard: transcript(req) },
		}));
		expect(
			await evalStr(interp, "(converse (list (message :user (list 1 2))))"),
		).toBe('"user: (1 2)"');
		expect(
			await evalStr(
				interp,
				'(extract (list "a" "b") (shape (heard :string)) :system (list :terse))',
			),
		).toBe(String.raw`(("heard" . "system: (:terse) | user: (\"a\" \"b\")"))`);
	});

	it("still refuses nil, so a missing value is not sent as text", async () => {
		const { interp } = llmInterp();
		expect(await failure(interp, "(write nil)")).toContain(
			"the prompt must not be nil",
		);
	});
});

describe("the summarization macros", () => {
	it("summarizes the value's printed form within a budget of its words", async () => {
		const { interp } = llmInterp((req) =>
			seesInOrder("(1 2 3)")(req) === "seen" ? settings(req) : "unseen",
		);
		expect(
			await evalStr(
				interp,
				"(progn (setq rows (list 1 2 3)) (summarize rows :words 10))",
			),
		).toBe('"default 40"');
	});

	it("passes its other options on, and lets :max-tokens win", async () => {
		const { interp } = llmInterp(settings);
		expect(
			await evalStr(
				interp,
				'(summarize "text" :words 30 :max-tokens 15 :provider :openrouter)',
			),
		).toBe('"openrouter 15"');
	});

	it("summarizes every element of a list, in order", async () => {
		const { interp } = llmInterp((req) =>
			req.messages[0].content.includes("alpha") ? "first" : "second",
		);
		expect(
			await evalStr(interp, '(summarize-each (list "alpha" "beta"))'),
		).toBe('("first" "second")');
	});

	it("takes its provider from with-writing", async () => {
		const { interp } = llmInterp(settings);
		expect(
			await evalStr(
				interp,
				'(with-writing (:provider :openrouter) (summarize-each (list "a")))',
			),
		).toBe('("openrouter 100")');
	});
});

describe("answer", () => {
	it("returns the model's answer when the context holds it", async () => {
		const { interp } = llmInterp((req) =>
			seesInOrder(
				"Ada Lovelace wrote the first algorithm.",
				"Who wrote it?",
			)(req) === "seen"
				? "Ada Lovelace"
				: "NOT-IN-CONTEXT",
		);
		expect(
			await evalStr(
				interp,
				`(progn (setq page "Ada Lovelace wrote the first algorithm.")
				        (answer "Who wrote it?" page))`,
			),
		).toBe('"Ada Lovelace"');
	});

	it("returns nil when the context does not answer it", async () => {
		const { interp } = llmInterp(() => "NOT-IN-CONTEXT");
		expect(await evalStr(interp, '(answer "When?" "no dates here")')).toBe(
			"nil",
		);
	});

	it("still returns nil when the model punctuates the sentinel", async () => {
		const { interp } = llmInterp(() => "NOT-IN-CONTEXT.");
		expect(await evalStr(interp, '(answer "When?" "no dates")')).toBe("nil");
	});

	it("reads a list of records as its context", async () => {
		const { interp } = llmInterp((req) =>
			seesInOrder('(("id" . "ENG-12") ("title" . "auth token"))')(req) ===
			"seen"
				? "ENG-12"
				: "NOT-IN-CONTEXT",
		);
		expect(
			await evalStr(
				interp,
				`(answer "Which issue mentions auth?"
				         (list (cons "id" "ENG-12") (cons "title" "auth token")))`,
			),
		).toBe('"ENG-12"');
	});

	it("passes its other options on, with :words setting the budget", async () => {
		const { interp } = llmInterp(settings);
		expect(
			await evalStr(
				interp,
				'(answer "q" "ctx" :words 10 :provider :openrouter :temperature 0.0)',
			),
		).toBe('"openrouter 40 0"');
	});
});

const GENERATIVE = [
	"invert",
	"negate",
	"blend",
	"strip",
	"open-with",
	"close-with",
	"conclude",
	"either",
	"one-of",
];

describe("the generative operators", () => {
	it.each(
		GENERATIVE.filter((f) => ["invert", "negate"].includes(f)),
	)("%s rewrites the printed value and returns the model's text", async (form) => {
		const { interp } = llmInterp(seesInOrder("(:a 1)"));
		expect(await evalStr(interp, `(${form} (list :a 1))`)).toBe('"seen"');
	});

	it.each(
		GENERATIVE.filter((f) => !["invert", "negate"].includes(f)),
	)("%s sends both values in order and returns the model's text", async (form) => {
		const { interp } = llmInterp(seesInOrder("alpha", "beta"));
		expect(await evalStr(interp, `(${form} "alpha" "beta")`)).toBe('"seen"');
	});

	it("passes its options on to write", async () => {
		const { interp } = llmInterp(settings);
		expect(
			await evalStr(
				interp,
				'(strip "Hello my enemy" "enemy" :provider :openrouter :max-tokens 20)',
			),
		).toBe('"openrouter 20"');
	});

	it("takes its provider from with-writing", async () => {
		const { interp } = llmInterp(settings);
		expect(
			await evalStr(
				interp,
				'(with-writing (:provider :openrouter) (negate "I am happy."))',
			),
		).toBe('"openrouter"');
	});
});

describe("documentation", () => {
	it("documents every binding the extension adds", async () => {
		const { interp } = llmInterp();
		const docs = interp.docs();
		for (const name of [
			"write",
			"converse",
			"extract",
			"message",
			"summarize",
			"summarize-each",
			"answer",
			"with-writing",
			"*writing-defaults*",
			...GENERATIVE,
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
			provider: "openrouter",
			model: "a-small-one",
			inputTokens: 11,
			outputTokens: 7,
		}));
		await runAsync(interp, '(write "greet me" :max-tokens 20)');
		expect(traced).toHaveLength(1);
		expect(traced[0]).toMatchObject({
			builtin: "write",
			provider: "openrouter",
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
			`(progn (converse (list (message :user "hi")))
			        (extract "x" (list (cons "a" :string))))`,
		);
		expect(traced.map((call) => [call.builtin, call.structured])).toEqual([
			["converse", false],
			["extract", true],
		]);
	});

	it("reports a failed call too, with the reason", async () => {
		const failed: LlmCall[] = [];
		const interp = new Interp({
			extensions: [
				llmExtension(
					{
						...llmHost,
						generate: () => Promise.reject(new Error("upstream is down")),
					},
					{
						observe: (call) => {
							failed.push(call);
						},
					},
				),
			],
		});
		boot(interp);
		await expect(runAsync(interp, '(write "hi")')).rejects.toThrow(
			/upstream is down/,
		);
		expect(failed).toHaveLength(1);
		expect(failed[0]).toMatchObject({
			builtin: "write",
			error: "upstream is down",
		});
		expect(failed[0].output).toBeUndefined();
	});

	it("never lets a broken observer break the call", async () => {
		const interp = new Interp({
			extensions: [
				llmExtension(
					{ ...llmHost, generate: async () => ({ text: "fine" }) },
					{
						observe: () => {
							throw new Error("observer exploded");
						},
					},
				),
			],
		});
		boot(interp);
		expect(str((await runAsync(interp, '(write "hi")')).value)).toBe('"fine"');
	});
});
