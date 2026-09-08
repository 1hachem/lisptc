import { isNumeric } from "@repo/interpreter/arith";
import {
	arrayToList,
	Cell,
	EvalException,
	type Interp,
	type InterpExtension,
	jsonToLisp,
	LispKeyword,
	type List,
	newLispKeyword,
	newSym,
	runSync,
	Sym,
	zAny,
	zList,
} from "@repo/interpreter/lisp";
import {
	keyName,
	plistOptions,
	splitKeywordArgs,
} from "@repo/interpreter/plist";
import { withTimeout } from "@repo/interpreter/promises";
import { type ChatMessage, ROLES, type Role } from "@repo/shared/messages";
import { z } from "zod";
import { langchainGenerate, listProviders } from "./llm-client.ts";

export const LLM_TIMEOUT_MS = 60_000;

export type LlmMessage = ChatMessage;

export interface LlmSchema {
	name: string;
	schema: Record<string, unknown>;
}

export interface LlmRequest {
	messages: LlmMessage[];
	provider?: string;
	model?: string;
	maxTokens?: number;
	temperature?: number;
	reasoningEffort?: string;
	schema?: LlmSchema;
}

export interface LlmResult {
	text: string;
	value?: unknown;
	provider?: string;
	model?: string;
	inputTokens?: number;
	outputTokens?: number;
}

export type Generate = (
	req: LlmRequest,
	signal?: AbortSignal,
) => Promise<LlmResult>;

export interface LlmCall {
	builtin: string;
	provider?: string;
	model?: string;
	messages: LlmMessage[];
	structured: boolean;
	latencyMs: number;
	output?: string;
	inputTokens?: number;
	outputTokens?: number;
	error?: string;
}

export type LlmObserver = (call: LlmCall) => void;

export interface ProviderReport {
	name: string;
	model: string;
	ready: boolean;
}

export interface LlmOptions {
	generate?: Generate;
	providers?: () => ProviderReport[];
	observe?: LlmObserver;
}

const DEFAULTS_VAR = "*llm-defaults*";

const CALL_OPTIONS = [
	"provider",
	"model",
	"max-tokens",
	"temperature",
	"system",
	"reasoning-effort",
	"timeout",
] as const;

const EXTRACT_OPTIONS = [...CALL_OPTIONS, "instructions"] as const;

const EXTRACT_SYSTEM =
	"You extract structured data. Use only what the input states: never invent a value, and leave a field empty when the input does not give it.";

const SCALARS: Record<string, string> = {
	string: "string",
	number: "number",
	integer: "integer",
	boolean: "boolean",
};

const FIELD_TYPES =
	":string :number :integer :boolean :any :enum :list :optional";

export function llmExtension(options: LlmOptions = {}): InterpExtension {
	return (interp: Interp): void => registerLlm(interp, options);
}

function asText(x: unknown, what: string): string {
	if (typeof x !== "string")
		throw new EvalException(`${what} must be a string`, x);
	return x;
}

function asName(x: unknown, what: string): string {
	if (typeof x === "string") return x;
	if (x instanceof Sym || x instanceof LispKeyword) return x.name;
	throw new EvalException(`${what} must be a string or keyword`, x);
}

function asNumber(x: unknown, what: string): number {
	if (!isNumeric(x)) throw new EvalException(`${what} must be a number`, x);
	return Number(x);
}

function elements(list: unknown, what: string): unknown[] {
	const out: unknown[] = [];
	for (let j: unknown = list; j !== null; j = (j as Cell).cdr) {
		if (!(j instanceof Cell)) throw new EvalException(what, list);
		out.push(j.car);
	}
	return out;
}

function globalDefaults(interp: Interp): Map<string, unknown> {
	const value = interp.getGlobal(newSym(DEFAULTS_VAR));
	if (value === null || value === undefined) return new Map();
	if (!(value instanceof Cell))
		throw new EvalException(`${DEFAULTS_VAR} must be a keyword list`, value);
	return plistOptions(value, EXTRACT_OPTIONS);
}

function optionsFor(
	interp: Interp,
	given: List,
	allowed: readonly string[],
): Map<string, unknown> {
	const out = new Map<string, unknown>();
	for (const [key, value] of globalDefaults(interp))
		if (allowed.includes(key)) out.set(key, value);
	for (const [key, value] of plistOptions(given, allowed)) out.set(key, value);
	return out;
}

function requestFrom(
	options: Map<string, unknown>,
	messages: LlmMessage[],
): LlmRequest {
	const system = options.get("system");
	const req: LlmRequest = {
		messages:
			system === undefined
				? messages
				: [{ role: "system", content: asText(system, ":system") }, ...messages],
	};
	if (options.has("provider"))
		req.provider = asName(options.get("provider"), ":provider");
	if (options.has("model")) req.model = asText(options.get("model"), ":model");
	if (options.has("max-tokens"))
		req.maxTokens = asNumber(options.get("max-tokens"), ":max-tokens");
	if (options.has("temperature"))
		req.temperature = asNumber(options.get("temperature"), ":temperature");
	if (options.has("reasoning-effort"))
		req.reasoningEffort = asName(
			options.get("reasoning-effort"),
			":reasoning-effort",
		);
	return req;
}

function timeoutOf(options: Map<string, unknown>): number {
	if (!options.has("timeout")) return LLM_TIMEOUT_MS;
	const ms = asNumber(options.get("timeout"), ":timeout");
	if (!Number.isFinite(ms) || ms < 0)
		throw new EvalException("invalid :timeout", options.get("timeout"));
	return ms;
}

function messageFrom(x: unknown): LlmMessage {
	if (typeof x === "string") return { role: "user", content: x };
	const fields = elements(
		x,
		'a message must be a string or an alist with "role" and "content"',
	);
	let role: string | undefined;
	let content: string | undefined;
	for (const field of fields) {
		if (!(field instanceof Cell))
			throw new EvalException(
				"a message field must be a (key . value) pair",
				field,
			);
		const key = keyName(field.car);
		if (key === "role") role = asName(field.cdr, '"role"');
		else if (key === "content") content = asText(field.cdr, '"content"');
	}
	if (role === undefined || content === undefined)
		throw new EvalException('a message needs both "role" and "content"', x);
	if (!ROLES.includes(role as Role))
		throw new EvalException(
			`unknown role; expected one of ${ROLES.join(" ")}`,
			role,
		);
	return { role: role as Role, content };
}

function messagesFrom(x: unknown): LlmMessage[] {
	if (typeof x === "string") return [{ role: "user", content: x }];
	const items = elements(x, "a list of messages expected");
	if (items.length === 0) throw new EvalException("no messages to send", x);
	return items.map(messageFrom);
}

interface Field {
	node: Record<string, unknown>;
	required: boolean;
}

function enumNode(values: unknown[], shape: unknown): Record<string, unknown> {
	if (values.length === 0)
		throw new EvalException("(:enum value...) needs at least one value", shape);
	const members = values.map((v) =>
		typeof v === "string" || v instanceof Sym || v instanceof LispKeyword
			? asName(v, "an enum value")
			: asNumber(v, "an enum value"),
	);
	return members.every((m) => typeof m === "string")
		? { type: "string", enum: members }
		: { enum: members };
}

function typedField(name: string, rest: unknown[], shape: unknown): Field {
	const scalar = SCALARS[name];
	if (scalar !== undefined) {
		const node: Record<string, unknown> = { type: scalar };
		if (rest.length > 0)
			node.description = asText(rest[0], "a field description");
		return { node, required: true };
	}
	if (name === "any") return { node: {}, required: true };
	if (name === "enum") return { node: enumNode(rest, shape), required: true };
	if (name === "list") {
		if (rest.length !== 1)
			throw new EvalException("(:list shape) takes one shape", shape);
		return {
			node: { type: "array", items: fieldFor(rest[0]).node },
			required: true,
		};
	}
	if (name === "optional") {
		if (rest.length !== 1)
			throw new EvalException("(:optional shape) takes one shape", shape);
		return { node: fieldFor(rest[0]).node, required: false };
	}
	throw new EvalException(
		`unknown field type; expected one of ${FIELD_TYPES}`,
		newLispKeyword(name),
	);
}

function objectField(shape: Cell): Field {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];
	for (const field of elements(shape, "an object shape must be an alist")) {
		if (!(field instanceof Cell))
			throw new EvalException(
				"a shape field must be a (key . shape) pair",
				field,
			);
		const value = fieldFor(field.cdr);
		const key = keyName(field.car);
		properties[key] = value.node;
		if (value.required) required.push(key);
	}
	if (Object.keys(properties).length === 0)
		throw new EvalException("a shape must name at least one field", shape);
	return {
		node: { type: "object", properties, required, additionalProperties: false },
		required: true,
	};
}

function fieldFor(shape: unknown): Field {
	if (shape instanceof LispKeyword) return typedField(shape.name, [], shape);
	if (typeof shape === "string")
		return { node: { type: "string", description: shape }, required: true };
	if (shape instanceof Cell) {
		if (shape.car instanceof LispKeyword)
			return typedField(
				shape.car.name,
				elements(shape.cdr, "a shape expected"),
				shape,
			);
		return objectField(shape);
	}
	throw new EvalException("unsupported shape", shape);
}

const UNWRAP = "value";

function extractionSchema(shape: unknown): {
	schema: Record<string, unknown>;
	unwrap: boolean;
} {
	const field = fieldFor(shape);
	if (field.node.type === "object")
		return { schema: field.node, unwrap: false };
	return {
		schema: {
			type: "object",
			properties: { [UNWRAP]: field.node },
			required: [UNWRAP],
			additionalProperties: false,
		},
		unwrap: true,
	};
}

function traceOf(
	builtin: string,
	req: LlmRequest,
	startedAt: number,
	res: LlmResult | undefined,
	error: unknown,
): LlmCall {
	const call: LlmCall = {
		builtin,
		messages: req.messages,
		structured: req.schema !== undefined,
		latencyMs: Date.now() - startedAt,
	};
	const provider = res?.provider ?? req.provider;
	const model = res?.model ?? req.model;
	if (provider !== undefined) call.provider = provider;
	if (model !== undefined) call.model = model;
	if (res !== undefined) {
		call.output = res.text;
		if (res.inputTokens !== undefined) call.inputTokens = res.inputTokens;
		if (res.outputTokens !== undefined) call.outputTokens = res.outputTokens;
	}
	if (error !== undefined)
		call.error = error instanceof Error ? error.message : String(error);
	return call;
}

function caller(
	generate: Generate,
	observe: LlmObserver | undefined,
): (builtin: string, req: LlmRequest, timeoutMs: number) => Promise<LlmResult> {
	const report = (call: LlmCall): void => {
		if (observe === undefined) return;
		try {
			observe(call);
		} catch {}
	};
	return (builtin, req, timeoutMs) => {
		const startedAt = Date.now();
		const controller = new AbortController();
		return withTimeout(generate(req, controller.signal), timeoutMs, "llm").then(
			(res) => {
				report(traceOf(builtin, req, startedAt, res, undefined));
				return res;
			},
			(ex) => {
				controller.abort();
				report(traceOf(builtin, req, startedAt, undefined, ex));
				throw ex;
			},
		);
	};
}

function oneValue(values: List, complaint: string, rest: List): unknown {
	if (values === null || values.cdr !== null)
		throw new EvalException(complaint, rest);
	return values.car;
}

export function registerLlm(interp: Interp, options: LlmOptions = {}): void {
	const generate = options.generate ?? langchainGenerate;
	const providers = options.providers ?? listProviders;
	const call = caller(generate, options.observe);

	interp.defineGlobal(newSym(DEFAULTS_VAR), null, {
		signature: DEFAULTS_VAR,
		doc: "The options every `llm/` call starts from, as a keyword list, e.g. `(setq *llm-defaults* (list :provider :openrouter :max-tokens 300))`. An option given at the call site wins over it. `with-llm` binds it for one block and restores it after.",
	});

	interp.def(
		"llm/complete",
		-1,
		'(llm/complete "prompt" [:system "..."] [:provider :name] [:model "id"] [:max-tokens n] [:temperature x] [:reasoning-effort :low] [:timeout ms])',
		"Send one prompt to a language model and return its reply as a string. The call waits for the reply, so the value is the text itself. Use `:system` for the model's instructions, `:provider`/`:model` to choose where it runs, `(llm/providers)` to see what is reachable, and `:max-tokens` to bound the answer. The reply is a value like any other: name it, `grep` it, `echo` it.",
		z.tuple([zList]),
		([rest]) => {
			const { values, options: given } = splitKeywordArgs(rest, CALL_OPTIONS);
			const prompt = oneValue(
				values,
				"llm/complete takes one prompt string, then keyword options",
				rest,
			);
			const opts = optionsFor(interp, given, CALL_OPTIONS);
			const req = requestFrom(opts, [
				{ role: "user", content: asText(prompt, "the prompt") },
			]);
			return call("llm/complete", req, timeoutOf(opts)).then((res) => res.text);
		},
	);

	interp.def(
		"llm/chat",
		-1,
		'(llm/chat messages [:provider :name] [:model "id"] [:max-tokens n] ...)',
		'Send a list of messages to a language model and return its reply as a string. A message is what `message` builds: an alist with "role" and "content". That is the shape of the `conversation` global too, so it can be passed straight in. A bare string in the list counts as a user message. Takes the same options as `llm/complete`.',
		z.tuple([zList]),
		([rest]) => {
			const { values, options: given } = splitKeywordArgs(rest, CALL_OPTIONS);
			const messages = oneValue(
				values,
				"llm/chat takes one list of messages, then keyword options",
				rest,
			);
			const opts = optionsFor(interp, given, CALL_OPTIONS);
			const req = requestFrom(opts, messagesFrom(messages));
			return call("llm/chat", req, timeoutOf(opts)).then((res) => res.text);
		},
	);

	interp.def(
		"llm/extract",
		-1,
		'(llm/extract text shape [:instructions "..."] [:provider :name] [:model "id"] ...)',
		'Read `text` with a language model and return the data `shape` asks for, as ordinary Lisp data. The model is constrained to the shape, so there is no parsing step and no stray prose. A shape is an alist of `(key . field)`. A field is `:string`, `:number`, `:integer`, `:boolean`, `:any`, a plain string (a string field, the text being what it means), `(:string "what it means")`, `(:enum "open" "closed")`, `(:list field)`, `(:optional field)`, or a nested alist for a nested object. An object shape comes back as an alist, a `(:list ...)` shape as a list. Add `:instructions` to say what to pull out.',
		z.tuple([zList]),
		([rest]) => {
			const { values, options: given } = splitKeywordArgs(
				rest,
				EXTRACT_OPTIONS,
			);
			const args = elements(values, "arguments expected");
			if (args.length !== 2)
				throw new EvalException(
					"llm/extract takes a text and a shape, then keyword options",
					rest,
				);
			const opts = optionsFor(interp, given, EXTRACT_OPTIONS);
			if (!opts.has("system")) opts.set("system", EXTRACT_SYSTEM);
			const instructions = opts.has("instructions")
				? `${asText(opts.get("instructions"), ":instructions")}\n\n`
				: "";
			const { schema, unwrap } = extractionSchema(args[1]);
			const req = requestFrom(opts, [
				{
					role: "user",
					content: `${instructions}${asText(args[0], "the text to read")}`,
				},
			]);
			req.schema = { name: "extraction", schema };
			return call("llm/extract", req, timeoutOf(opts)).then((res) => {
				const value = unwrap
					? (res.value as Record<string, unknown> | null)?.[UNWRAP]
					: res.value;
				return jsonToLisp(value);
			});
		},
	);

	interp.def(
		"llm/providers",
		0,
		"(llm/providers)",
		"Return the language-model providers this REPL can reach, each as `(provider default-model status)`. The status is `:ready`, or `:no-api-key` when its key is missing from the environment. The first entry is what a call with no `:provider` uses.",
		z.tuple([]),
		() =>
			arrayToList(
				providers().map((p) =>
					arrayToList([
						newLispKeyword(p.name),
						p.model,
						newLispKeyword(p.ready ? "ready" : "no-api-key"),
					]),
				),
			),
	);

	interp.def(
		"message",
		2,
		'(message :user "content")',
		'Build one chat message for `llm/chat`: an alist with "role" and "content". The role is `:system`, `:user` or `:assistant`.',
		z.tuple([zAny, zAny]),
		([role, content]) => {
			const name = asName(role, "a role");
			if (!ROLES.includes(name as Role))
				throw new EvalException(
					`unknown role; expected one of ${ROLES.join(" ")}`,
					role,
				);
			return arrayToList([
				new Cell("role", name),
				new Cell("content", asText(content, "the content")),
			]);
		},
	);

	runSync(interp, MACROS);
}

const MACROS = `
(setq _llm-option
      (lambda (options key default)
        (cond ((null options) default)
              ((eq (car options) key) (car (cdr options)))
              (t (_llm-option (cdr (cdr options)) key default)))))

(setq _llm-drop
      (lambda (options key)
        (cond ((null options) nil)
              ((eq (car options) key) (_llm-drop (cdr (cdr options)) key))
              (t (cons (car options)
                       (cons (car (cdr options))
                             (_llm-drop (cdr (cdr options)) key)))))))

(setq summarize
      (macro (value &rest options)
        \`(llm/complete
           (concat "Summarize the input below in about "
                   ,(string (_llm-option options :words 60))
                   " words. Keep the names, numbers and conclusions. Write the summary only.\\n\\n"
                   (string ,value))
           :max-tokens ,(_llm-option options :max-tokens
                                     (* 4 (_llm-option options :words 60)))
           ,@(_llm-drop (_llm-drop options :words) :max-tokens))))
(_set-doc 'summarize "(summarize value [:words n] [option...])"
          "Summarize any value with a language model and return the summary text. Expands to an llm/complete call whose prompt carries the value's printed form, so it reads a list of records as well as a page of text. :words (default 60) sets both the length asked for and the token budget; every other option is passed on to llm/complete.")

(setq summarize-each
      (macro (values &rest options)
        \`(mapcar (lambda (_llm-item)
                   (summarize _llm-item
                              :words ,(_llm-option options :words 25)
                              ,@(_llm-drop options :words)))
                 ,values)))
(_set-doc 'summarize-each "(summarize-each values [:words n] [option...])"
          "Summarize every element of a list and return the list of summaries, in order. One model call per element, run in sequence, so :words (default 25) keeps each one short.")

(setq llm/answer
      (macro (question context &rest options)
        \`(let ((_llm-answer
                  (llm/complete
                    (concat "Context:\\n" (string ,context)
                            "\\n\\nQuestion: " (string ,question))
                    :system ,(concat
                               "Answer the question from the context alone. Use nothing you know from outside it, prefer its own words, and never guess or fill a gap. If the context does not contain the answer, reply with exactly NOT-IN-CONTEXT and nothing else. Answer in at most "
                               (string (_llm-option options :words 60))
                               " words, with no preamble.")
                    :max-tokens ,(_llm-option options :max-tokens
                                              (* 4 (_llm-option options :words 60)))
                    ,@(_llm-drop (_llm-drop options :words) :max-tokens))))
           (if (string-prefix? "NOT-IN-CONTEXT" _llm-answer) nil _llm-answer))))
(_set-doc 'llm/answer "(llm/answer question context [:words n] [option...])"
          "Answer a question from a context and nothing else, and return the answer text. The context is any value: its printed form goes into the prompt, so a list of records works as well as a page of text. The model is told to use the context alone, so when the context does not contain the answer this returns nil rather than a guess -- test it with (if (llm/answer q ctx) ...) and never treat nil as a failed call. :words (default 60) caps the length and the token budget; every other option is passed on to llm/complete, an explicit :system included, which replaces the grounding instruction and is rarely what you want.")

(setq with-llm
      (macro (options &rest body)
        \`(let ((_llm-saved *llm-defaults*))
           (setq *llm-defaults* (append _llm-saved (list ,@options)))
           (let ((_llm-value (try (progn ,@body)
                                  (catch (e)
                                    (setq *llm-defaults* _llm-saved)
                                    (error e)))))
             (setq *llm-defaults* _llm-saved)
             _llm-value))))
(_set-doc 'with-llm "(with-llm (option...) body...)"
          "Evaluate the body with *llm-defaults* extended by the given options, then restore it, so a block of code can pin a provider or a model without repeating it: (with-llm (:provider :llamacpp :max-tokens 200) (summarize-each pages)). A call in the body can still override any of them.")
`;
