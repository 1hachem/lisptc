import { isNumeric } from "@repo/interpreter/arith";
import { EvalException, messageOf } from "@repo/interpreter/errors";
import { record } from "@repo/interpreter/journal";
import {
	type Interp,
	runSync,
	type State,
	type StateCodec,
} from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	jsonToLisp,
	LispKeyword,
	type List,
	newLispKeyword,
	newSym,
	Sym,
} from "@repo/interpreter/objects";
import {
	type LlmCall,
	type LlmObserver,
	llmSlot,
} from "@repo/interpreter/observe";
import {
	keyName,
	plistOptions,
	splitKeywordArgs,
} from "@repo/interpreter/plist";
import { str } from "@repo/interpreter/print";
import { LispPromise } from "@repo/interpreter/promise";
import { zAny, zList } from "@repo/interpreter/schema";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { withTimeout } from "@repo/interpreter/timeout";
import {
	type ActivityEntry,
	activityKind,
} from "@repo/journal-catalog/activity";
import type { Clock, PromptSource } from "@repo/shared/host";
import { type ChatMessage, ROLES, type Role } from "@repo/shared/messages";
import { z } from "zod";

export const LLM_TIMEOUT_MS = 60_000;

const callSeqCodec: StateCodec<number> = {
	toLisp: (n) => BigInt(n),
	fromLisp: (x) => Number(x),
};

interface Timing {
	readonly startedAt: number;
	readonly ms?: number;
}

type Announce = (
	id: string,
	builtin: string,
	state: ActivityEntry["state"],
	target: { provider?: string; model?: string },
	timing: Timing,
	error?: unknown,
) => void;

function announcer(interp: Interp): Announce {
	return (id, builtin, state, _target, timing, error) =>
		record(interp.channels, activityKind, {
			kind: "llm",
			icon: "model",
			label: builtin,
			state,
			...(error === undefined ? {} : { error: messageOf(error) }),
			id,
			...timing,
		});
}

export interface LlmSchema {
	name: string;
	schema: Record<string, unknown>;
}

export interface LlmRequest {
	messages: ChatMessage[];
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

export interface LlmHost {
	generate: Generate;
	clock: Clock;
	prompt: PromptSource;
}

export interface LlmOptions {
	observe?: LlmObserver;
}

const DEFAULTS_VAR = "*writing-defaults*";

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

export interface LlmExtension extends InterpExtension {
	observe?: LlmObserver;
}

export function llmExtension(
	host: LlmHost,
	options: LlmOptions = {},
): LlmExtension {
	const config = { observe: options.observe };
	const extension: LlmExtension = Object.assign(
		(interp: Interp): void => {
			registerLlm(interp, host, () => config.observe);
		},
		{
			prompt: host.prompt(),
			session(hooks: SessionHooks): void {
				hooks.fill(llmSlot, {
					set observe(observer: LlmObserver | undefined) {
						config.observe = observer;
					},
					get observe(): LlmObserver | undefined {
						return config.observe;
					},
				});
			},
		},
	);
	Object.defineProperty(extension, "observe", {
		enumerable: true,
		get: () => config.observe,
		set: (observer: LlmObserver | undefined) => {
			config.observe = observer;
		},
	});
	return extension;
}

function asText(x: unknown, what: string): string {
	if (typeof x !== "string")
		throw new EvalException(`${what} must be a string`, x);
	return x;
}

function asContent(x: unknown, what: string): string {
	if (typeof x === "string") return x;
	if (x === null) throw new EvalException(`${what} must not be nil`, x);
	if (x instanceof LispPromise)
		throw new EvalException(`${what} must not be a promise; await it first`, x);
	if (
		x === true ||
		x instanceof Cell ||
		x instanceof Sym ||
		x instanceof LispKeyword ||
		isNumeric(x)
	)
		return str(x, false);
	throw new EvalException(`${what} must be a string or Lisp data`, x);
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
	messages: ChatMessage[],
): LlmRequest {
	const system = options.get("system");
	const req: LlmRequest = {
		messages:
			system === undefined
				? messages
				: [
						{ role: "system", content: asContent(system, ":system") },
						...messages,
					],
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

function messageFrom(x: unknown): ChatMessage {
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
		else if (key === "content") content = asContent(field.cdr, '"content"');
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

function messagesFrom(x: unknown): ChatMessage[] {
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
	elapsedMs: number,
	res: LlmResult | undefined,
	error: unknown,
): LlmCall {
	const call: LlmCall = {
		builtin,
		messages: req.messages,
		structured: req.schema !== undefined,
		latencyMs: elapsedMs,
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
	if (error !== undefined) call.error = messageOf(error);
	return call;
}

function caller(
	generate: Generate,
	clock: Clock,
	observe: () => LlmObserver | undefined,
	calls: State<number>,
	announce: Announce,
): (builtin: string, req: LlmRequest, timeoutMs: number) => Promise<LlmResult> {
	const report = (call: LlmCall): void => {
		const observer = observe();
		if (observer === undefined) return;
		try {
			observer(call);
		} catch {}
	};
	return (builtin, req, timeoutMs) => {
		const n = calls.get() + 1;
		calls.set(n);
		const id = `llm-${n}`;
		const startedAt = clock.now();
		announce(id, builtin, "started", req, { startedAt });
		const controller = new AbortController();
		return withTimeout(
			generate(req, controller.signal),
			timeoutMs,
			builtin,
		).then(
			(res) => {
				const ms = clock.now() - startedAt;
				announce(
					id,
					builtin,
					"done",
					{
						provider: res.provider ?? req.provider,
						model: res.model ?? req.model,
					},
					{ startedAt, ms },
				);
				report(traceOf(builtin, req, ms, res, undefined));
				return res;
			},
			(ex) => {
				const ms = clock.now() - startedAt;
				announce(id, builtin, "failed", req, { startedAt, ms }, ex);
				controller.abort();
				report(traceOf(builtin, req, ms, undefined, ex));
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

export function registerLlm(
	interp: Interp,
	host: LlmHost,
	observe: () => LlmObserver | undefined = () => undefined,
): void {
	const calls = interp.state(
		"llm/calls",
		callSeqCodec,
		0,
		"The number of the last writing call, which numbers the activity the user sees.",
	);
	const call = caller(
		host.generate,
		host.clock,
		observe,
		calls,
		announcer(interp),
	);

	interp.defineGlobal(newSym(DEFAULTS_VAR), null, {
		signature: DEFAULTS_VAR,
		doc: "The options every write, converse and extract call starts from, as a keyword list, e.g. `(setq *writing-defaults* (list :max-tokens 300 :temperature 0.2))`. An option given at the call site wins over it. `with-writing` binds it for one block and restores it after.",
	});

	interp.def(
		"write",
		-1,
		'(write "prompt" [:system "..."] [:max-tokens n] [:temperature x] [:reasoning-effort :low] [:timeout ms])',
		"Write a reply to one prompt and return it as a string. The call waits for the reply, so the value is the text itself. The prompt is any value, not just a string: a list of records goes in as its printed form, so there is no `(string …)` to write around it. Use `:system` for standing instructions and `:max-tokens` to bound the answer. The reply is a value like any other: name it, `grep` it, `echo` it.",
		z.tuple([zList]),
		([rest]) => {
			const { values, options: given } = splitKeywordArgs(rest, CALL_OPTIONS);
			const prompt = oneValue(
				values,
				"write takes one prompt string, then keyword options",
				rest,
			);
			const opts = optionsFor(interp, given, CALL_OPTIONS);
			const req = requestFrom(opts, [
				{ role: "user", content: asContent(prompt, "the prompt") },
			]);
			return call("write", req, timeoutOf(opts)).then((res) => res.text);
		},
	);

	interp.def(
		"converse",
		-1,
		"(converse messages [:max-tokens n] ...)",
		'Write the next reply in a list of messages and return it as a string. A message is what `message` builds: an alist with "role" and "content". That is the shape of the `conversation` global too, so it can be passed straight in. A bare string in the list counts as a user message. Takes the same options as `write`.',
		z.tuple([zList]),
		([rest]) => {
			const { values, options: given } = splitKeywordArgs(rest, CALL_OPTIONS);
			const messages = oneValue(
				values,
				"converse takes one list of messages, then keyword options",
				rest,
			);
			const opts = optionsFor(interp, given, CALL_OPTIONS);
			const req = requestFrom(opts, messagesFrom(messages));
			return call("converse", req, timeoutOf(opts)).then((res) => res.text);
		},
	);

	interp.def(
		"extract",
		-1,
		'(extract text shape [:instructions "..."] ...)',
		'Read `text` and return the data `shape` asks for, as ordinary Lisp data. The answer is constrained to the shape, so there is no parsing step and no stray prose. A shape is an alist of `(key . field)`, which `(shape (title :string) …)` builds for you. A field is `:string`, `:number`, `:integer`, `:boolean`, `:any`, a plain string (a string field, the text being what it means), `(:string "what it means")`, `(:enum "open" "closed")`, `(:list field)`, `(:optional field)`, or a nested alist for a nested object. An object shape comes back as an alist, a `(:list ...)` shape as a list. Add `:instructions` to say what to pull out. The `text` is any value: a list of records is read as its printed form.',
		z.tuple([zList]),
		([rest]) => {
			const { values, options: given } = splitKeywordArgs(
				rest,
				EXTRACT_OPTIONS,
			);
			const args = elements(values, "arguments expected");
			if (args.length !== 2)
				throw new EvalException(
					"extract takes a text and a shape, then keyword options",
					rest,
				);
			const opts = optionsFor(interp, given, EXTRACT_OPTIONS);
			if (!opts.has("system")) opts.set("system", EXTRACT_SYSTEM);
			const instructions = opts.has("instructions")
				? `${asContent(opts.get("instructions"), ":instructions")}\n\n`
				: "";
			const { schema, unwrap } = extractionSchema(args[1]);
			const req = requestFrom(opts, [
				{
					role: "user",
					content: `${instructions}${asContent(args[0], "the text to read")}`,
				},
			]);
			req.schema = { name: "extraction", schema };
			return call("extract", req, timeoutOf(opts)).then((res) => {
				const value = unwrap
					? (res.value as Record<string, unknown> | null)?.[UNWRAP]
					: res.value;
				return jsonToLisp(value);
			});
		},
	);

	interp.def(
		"message",
		2,
		'(message :user "content")',
		'Build one chat message for `converse`: an alist with "role" and "content". The role is `:system`, `:user` or `:assistant`, and the content is any value, a list of records included.',
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
				new Cell("content", asContent(content, "the content")),
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

(setq _shape-keyword
      (lambda (x) (string-prefix? ":" (string x))))

(setq _shape-pair
      (lambda (clause)
        (cond ((not (consp clause))
               (error "shape: every field is written (name spec...)"))
              (t (cons (car clause) (_shape-field (cdr clause)))))))

(setq _shape-group
      (lambda (field)
        (cond ((not (consp field)) field)
              ((memq (car field) '(:list :optional))
               (list (car field) (_shape-field (cdr field))))
              (t field))))

(setq _shape-field
      (lambda (specs)
        (cond ((null specs)
               (error "shape: a field needs a type, as (name :string)"))
              ((and (consp (car specs)) (not (_shape-keyword (car (car specs)))))
               (mapcar _shape-pair specs))
              ((null (cdr specs)) (_shape-group (car specs)))
              (t (_shape-group specs)))))

(setq shape
      (macro (&rest fields)
        (cond ((null fields) (error "shape needs at least one field"))
              (t (list 'quote (mapcar _shape-pair fields))))))
(_set-doc 'shape "(shape (name spec...)...)"
          "Build a shape for extract without the quoting and the dotted pairs: (shape (title :string) (stars :integer) (state (:enum \\"open\\" \\"closed\\")) (links (:list :string)) (author (:optional :string))) is the alist ((title . :string) (stars . :integer) ...), which is what extract reads. A spec is a type keyword, a description string, (:string \\"what it means\\"), or a nested (name spec...) group for a nested object; (:list ...) and (:optional ...) take a group too, so (items (:list (id :number) (title :string))) is a list of objects. The name is a symbol -- write it as a string when the field name has a space. The shape is literal, built when the form is compiled, so a computed enum still needs the alist written by hand.")

(setq summarize
      (macro (value &rest options)
        \`(write
           (concat "Summarize the input below in about "
                   ,(string (_llm-option options :words 60))
                   " words. Keep the names, numbers and conclusions. Write the summary only.\\n\\n"
                   (string ,value))
           :max-tokens ,(_llm-option options :max-tokens
                                     (* 4 (_llm-option options :words 60)))
           ,@(_llm-drop (_llm-drop options :words) :max-tokens))))
(_set-doc 'summarize "(summarize value [:words n] [option...])"
          "Summarize any value and return the summary text. Expands to a write call whose prompt carries the value's printed form, so it reads a list of records as well as a page of text. :words (default 60) sets both the length asked for and the token budget; every other option is passed on to write.")

(setq summarize-each
      (macro (values &rest options)
        \`(mapcar (lambda (_llm-item)
                   (summarize _llm-item
                              :words ,(_llm-option options :words 25)
                              ,@(_llm-drop options :words)))
                 ,values)))
(_set-doc 'summarize-each "(summarize-each values [:words n] [option...])"
          "Summarize every element of a list and return the list of summaries, in order. One call per element, run in sequence, so :words (default 25) keeps each one short.")

(setq answer
      (macro (question context &rest options)
        \`(let ((_llm-answer
                  (write
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
(_set-doc 'answer "(answer question context [:words n] [option...])"
          "Answer a question from a context and nothing else, and return the answer text. The context is any value: its printed form goes into the prompt, so a list of records works as well as a page of text. It answers from the context alone, so when the context does not contain the answer this returns nil rather than a guess -- test it with (if (answer q ctx) ...) and never treat nil as a failed call. :words (default 60) caps the length and the token budget; every other option is passed on to write, an explicit :system included, which replaces the grounding instruction and is rarely what you want.")

(setq _llm-transform
      (lambda (task inputs options)
        (apply write
               (cons (concat task " Write the result only, with no preamble.\\n\\n"
                             (cond ((null (cdr inputs)) (string (car inputs)))
                                   (t (concat "First:\\n" (string (car inputs))
                                              "\\n\\nSecond:\\n" (string (car (cdr inputs)))))))
                     options))))

(setq invert
      (lambda (x &rest options)
        (_llm-transform "Invert the input below: swap its roles or direction so it states the reverse relation, in the same form. \\"I am standing on the shoulders of giants.\\" becomes \\"Giants are standing on my shoulders.\\""
                        (list x) options)))
(_set-doc 'invert "(invert x [option...])"
          "Return x with its roles or direction swapped: (invert \\"I stand on the shoulders of giants.\\") is \\"Giants stand on my shoulders.\\" Every option is passed on to write.")

(setq negate
      (lambda (x &rest options)
        (_llm-transform "Negate the input below: make it state the opposite of what it states, changing as little as possible."
                        (list x) options)))
(_set-doc 'negate "(negate x [option...])"
          "Return x saying the opposite: (negate \\"I am happy.\\") is \\"I am not happy.\\" Every option is passed on to write.")

(setq blend
      (lambda (x y &rest options)
        (_llm-transform "Combine the two inputs below into one coherent text that carries the meaning of both."
                        (list x y) options)))
(_set-doc 'blend "(blend x y [option...])"
          "Return x and y blended into one text: (blend \\"Hello my\\" \\"friend\\") is \\"Hello my friend\\". Every option is passed on to write.")

(setq strip
      (lambda (x y &rest options)
        (_llm-transform "Remove from the first input what the second input names or means, and keep the rest of the first as written."
                        (list x y) options)))
(_set-doc 'strip "(strip x y [option...])"
          "Return x with what y names or means taken out: (strip \\"Hello my enemy\\" \\"enemy\\") is \\"Hello my\\". Every option is passed on to write.")

(setq open-with
      (lambda (x y &rest options)
        (_llm-transform "Work the second input into the beginning of the first so the result reads naturally."
                        (list x y) options)))
(_set-doc 'open-with "(open-with x y [option...])"
          "Return x with y worked in at its start: (open-with \\"high priority task\\" \\"urgent\\") is \\"urgent high priority task\\". Every option is passed on to write.")

(setq close-with
      (lambda (x y &rest options)
        (_llm-transform "Work the second input into the end of the first so the result reads naturally."
                        (list x y) options)))
(_set-doc 'close-with "(close-with x y [option...])"
          "Return x with y worked in at its end: (close-with \\"data processing\\" \\"downstream\\") is \\"data processing downstream\\". Every option is passed on to write.")

(setq conclude
      (lambda (x y &rest options)
        (_llm-transform "Take both inputs below as true and state what follows from them together."
                        (list x y) options)))
(_set-doc 'conclude "(conclude x y [option...])"
          "Return what follows from x and y taken together: (conclude \\"The horn only sounds on Sundays.\\" \\"I hear the horn.\\") concludes it is Sunday. Every option is passed on to write.")

(setq either
      (lambda (x y &rest options)
        (_llm-transform "State the two inputs below as alternatives, either or both of which may hold."
                        (list x y) options)))
(_set-doc 'either "(either x y [option...])"
          "Return x and y stated as alternatives that may both hold. Every option is passed on to write.")

(setq one-of
      (lambda (x y &rest options)
        (_llm-transform "State the two inputs below as mutually exclusive alternatives: exactly one of them holds."
                        (list x y) options)))
(_set-doc 'one-of "(one-of x y [option...])"
          "Return x and y stated as alternatives of which exactly one holds: (one-of \\"The door is open.\\" \\"The door is closed.\\"). Every option is passed on to write.")

(setq with-writing
      (macro (options &rest body)
        \`(let ((_llm-saved *writing-defaults*))
           (setq *writing-defaults* (append _llm-saved (list ,@options)))
           (let ((_llm-value (try (progn ,@body)
                                  (catch (e)
                                    (setq *writing-defaults* _llm-saved)
                                    (error e)))))
             (setq *writing-defaults* _llm-saved)
             _llm-value))))
(_set-doc 'with-writing "(with-writing (option...) body...)"
          "Evaluate the body with *writing-defaults* extended by the given options, then restore it, so a block of code can pin a setting without repeating it: (with-writing (:max-tokens 200) (summarize-each pages)). A call in the body can still override any of them.")
`;
