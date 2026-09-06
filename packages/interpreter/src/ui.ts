import { z } from "zod";
import type { Channels, Diagnostic } from "./channels.ts";
import {
	Cell,
	callableArity,
	type DocArg,
	EvalException,
	type Interp,
	type InterpExtension,
	jsonToLisp,
	type List,
	newSym,
	str,
	Unspecified,
	zAny,
	zList,
} from "./lisp.ts";
import { plistOptions, splitKeywordArgs } from "./plist.ts";

const MAX_HANDLERS = 500;

const MAX_ROWS = 200;

const MAX_MESSAGE_CHARS = 4000;

export const UI = "ui";

export type UiEvent =
	| { kind: "view"; node: UiNode }
	| { kind: "message"; text: string };

export function joinMessages(parts: readonly string[]): string | undefined {
	if (parts.length === 0) return undefined;
	const text = parts.join("\n\n");
	if (text.length <= MAX_MESSAGE_CHARS) return text;
	return `${text.slice(0, MAX_MESSAGE_CHARS)}\n… (message truncated)`;
}

export type UiValue =
	| string
	| number
	| boolean
	| null
	| UiValue[]
	| { [key: string]: UiValue };

export interface UiNode {
	tag: string;
	props: Record<string, UiValue>;
	children: UiNode[];
}

class UiElement implements UiNode {
	constructor(
		readonly tag: string,
		readonly props: Record<string, UiValue>,
		readonly children: UiNode[] = [],
	) {}

	toString(): string {
		return `#<ui:${this.tag}>`;
	}
}

export class UiSurface {
	private readonly handlers = new Map<string, unknown>();
	private interp: Interp | undefined;
	private channels: Channels | undefined;
	private seq = 0;

	bind(interp: Interp): void {
		this.interp = interp;
		this.channels = interp.channels;
	}

	private emit(event: UiEvent): void {
		const text = event.kind === "view" ? `<ui ${event.node.tag}>` : event.text;
		this.channels?.emit({ channel: UI, text, value: event } as Diagnostic);
	}

	action(fn: unknown): string {
		if (callableArity(fn) === undefined)
			throw new EvalException("function expected as a ui action", fn);
		const id = `a${++this.seq}`;
		this.handlers.set(id, fn);
		while (this.handlers.size > MAX_HANDLERS) {
			const oldest = this.handlers.keys().next().value;
			if (oldest === undefined) break;
			this.handlers.delete(oldest);
		}
		return id;
	}

	render(node: UiNode): void {
		this.emit({ kind: "view", node });
	}

	send(text: string): void {
		this.emit({ kind: "message", text });
	}

	hasAction(id: string): boolean {
		return this.handlers.has(id);
	}

	invoke(id: string, values: Record<string, unknown>): unknown {
		const fn = this.handlers.get(id);
		if (fn === undefined)
			throw new EvalException("no such ui action", id, false);
		const interp = this.interp;
		if (interp === undefined)
			throw new EvalException("ui surface is not bound to an interpreter", id);
		const arity = callableArity(fn);
		const takesValues = arity !== undefined && (arity.max ?? 1) > 0;
		const args: List = takesValues
			? new Cell(quoted(jsonToLisp(values)), null)
			: null;
		return interp.eval(new Cell(fn, args), null);
	}
}

function quoted(x: unknown): unknown {
	return new Cell(newSym("quote"), new Cell(x, null));
}

const zString = z.custom<string>(
	(x) => typeof x === "string",
	"string expected",
);

function listElements(x: unknown): unknown[] | undefined {
	if (x === null) return [];
	if (!(x instanceof Cell)) return undefined;
	const out: unknown[] = [];
	for (let p: unknown = x; p instanceof Cell; p = p.cdr) out.push(p.car);
	return out;
}

function toJson(x: unknown): UiValue {
	if (x === null || x === undefined) return null;
	if (x === true) return true;
	if (typeof x === "number") return x;
	if (typeof x === "bigint") return Number(x);
	if (typeof x === "string") return x;
	if (x instanceof UiElement) return nodeToJson(x);
	const items = listElements(x);
	if (items !== undefined) {
		if (
			items.length > 0 &&
			items.every((i) => i instanceof Cell && typeof i.car === "string")
		) {
			const out: Record<string, UiValue> = {};
			for (const pair of items as Cell[])
				out[pair.car as string] = toJson(pair.cdr);
			return out;
		}
		return items.map(toJson);
	}
	return str(x, false);
}

export function nodeToJson(node: UiNode): UiValue {
	return {
		tag: node.tag,
		props: node.props,
		children: node.children.map(nodeToJson),
	};
}

function childNodes(values: List): UiNode[] {
	const out: UiNode[] = [];
	for (const child of listElements(values) ?? []) {
		if (child instanceof UiElement) out.push(child);
		else if (typeof child === "string")
			out.push(new UiElement("text", { text: child }));
		else if (child !== null)
			throw new EvalException("ui element expected as a child", child);
	}
	return out;
}

function stringOption(
	opts: Map<string, unknown>,
	name: string,
): string | undefined {
	if (!opts.has(name)) return undefined;
	const value = opts.get(name);
	if (typeof value !== "string")
		throw new EvalException(`string expected for :${name}`, value);
	return value;
}

function withOptions(
	props: Record<string, UiValue>,
	opts: Map<string, unknown>,
	names: readonly string[],
): Record<string, UiValue> {
	for (const name of names) {
		const value = stringOption(opts, name);
		if (value !== undefined) props[name] = value;
	}
	return props;
}

const ACTION_PROPS = ["action", "on-change"] as const;

const TONES = ["ok", "warn", "bad", "info", "muted"] as const;

function booleanOption(
	opts: Map<string, unknown>,
	name: string,
): boolean | undefined {
	if (!opts.has(name)) return undefined;
	return opts.get(name) !== null;
}

function actionOption(
	surface: UiSurface,
	opts: Map<string, unknown>,
	name: string,
): string | undefined {
	if (!opts.has(name)) return undefined;
	return surface.action(opts.get(name));
}

function summarize(node: UiNode): { elements: number; actions: number } {
	let elements = 1;
	let actions = ACTION_PROPS.filter(
		(prop) => typeof node.props[prop] === "string",
	).length;
	for (const child of node.children) {
		const sub = summarize(child);
		elements += sub.elements;
		actions += sub.actions;
	}
	return { elements, actions };
}

const INPUT_OPTIONS = ["name", "label", "placeholder", "value"];
const SELECT_OPTIONS = ["name", "label", "value", "on-change"];
const CHECKBOX_OPTIONS = ["name", "label", "checked", "on-change"];

const INPUT_ARGS: DocArg[] = [
	{
		name: "name",
		type: "string",
		required: true,
		description: "the key this field's value arrives under in the handler",
	},
	{
		name: "label",
		type: "string",
		required: false,
		description: "text shown beside the field",
	},
	{
		name: "placeholder",
		type: "string",
		required: false,
		description: "hint text shown while the field is empty",
	},
	{
		name: "value",
		type: "string",
		required: false,
		description: "the field's initial contents",
	},
];

function registerUi(interp: Interp, surface: UiSurface): void {
	surface.bind(interp);

	interp.def(
		"ui/text",
		1,
		"(ui/text s)",
		"A line of text. The plainest widget: use it for anything you would otherwise echo.",
		z.tuple([zAny]),
		([s]) =>
			new UiElement("text", { text: typeof s === "string" ? s : str(s) }),
	);

	interp.def(
		"ui/heading",
		1,
		"(ui/heading s)",
		"A heading for the section under it.",
		z.tuple([zString]),
		([s]) => new UiElement("heading", { text: s }),
	);

	interp.def(
		"ui/markdown",
		1,
		"(ui/markdown s)",
		"A block of markdown, rendered as markdown. Use it for prose; use `ui/table` for data.",
		z.tuple([zString]),
		([s]) => new UiElement("markdown", { text: s }),
	);

	interp.def(
		"ui/link",
		2,
		"(ui/link text url)",
		"A link, opened in a new tab. Nothing runs in the REPL — this is the one interactive widget with no handler. Use it for a URL a tool handed you (an issue, a PR, a dashboard) so the user can follow it instead of copying it out of a table.",
		z.tuple([zString, zString]),
		([text, url]) => new UiElement("link", { text, href: url }),
	);

	interp.def(
		"ui/badge",
		-2,
		'(ui/badge text [:tone "ok"])',
		`A short status label. \`:tone\` is one of ${TONES.join(" ")} and colours it; without one it draws plain. For the state of a thing — an issue's status, a check's result, a severity — where a whole sentence would be noise.`,
		z.tuple([zString, zList]),
		([text, rest]) => {
			const opts = plistOptions(rest, ["tone"]);
			const tone = stringOption(opts, "tone");
			if (tone !== undefined && !(TONES as readonly string[]).includes(tone))
				throw new EvalException(
					`unknown tone; expected one of ${TONES.join(" ")}`,
					tone,
				);
			return new UiElement(
				"badge",
				tone === undefined ? { text } : { text, tone },
			);
		},
	);

	interp.def(
		"ui/kpi",
		-3,
		'(ui/kpi label value [:hint "…"])',
		'One number, big. The most understanding per token of anything here: `(ui/kpi "open" 27)` says at a glance what a 27-row table says in a screenful. `:hint` is a smaller line under it — a comparison, a unit, a caveat.',
		z.tuple([zString, zAny, zList]),
		([label, value, rest]) => {
			const opts = plistOptions(rest, ["hint"]);
			return new UiElement(
				"kpi",
				withOptions(
					{
						label,
						value: typeof value === "string" ? value : str(value, false),
					},
					opts,
					["hint"],
				),
			);
		},
	);

	interp.def(
		"ui/stack",
		-1,
		"(ui/stack child...)",
		"Lay the widgets out one above the next. A bare string child becomes `ui/text`.",
		z.tuple([zList]),
		([rest]) => new UiElement("stack", {}, childNodes(rest)),
	);

	interp.def(
		"ui/row",
		-1,
		"(ui/row child...)",
		"Lay the widgets out side by side. A bare string child becomes `ui/text`.",
		z.tuple([zList]),
		([rest]) => new UiElement("row", {}, childNodes(rest)),
	);

	interp.def(
		"ui/card",
		-2,
		"(ui/card title child...)",
		"A titled box around the widgets. Use it to break a view into named parts — a long `ui/stack` with no cards reads as one wall of things.",
		z.tuple([zString, zList]),
		([title, rest]) => new UiElement("card", { title }, childNodes(rest)),
	);

	interp.def(
		"ui/button",
		2,
		"(ui/button label action)",
		"A button. `action` is a function run IN THIS REPL when the user clicks it — with no model turn in between, so a button is how you offer something without spending a step on it. Write it as `(lambda () …)`; inside a `ui/form` write `(lambda (values) …)` to receive the fields. Whatever the action renders replaces the view.",
		z.tuple([zString, zAny]),
		([label, action]) =>
			new UiElement("button", { label, action: surface.action(action) }),
	);

	interp.def(
		"ui/input",
		-1,
		'(ui/input :name "q" [:label "Search"] [:placeholder "…"] [:value ""])',
		"A text field. Its `:name` is the key its contents arrive under in the enclosing form's handler.",
		z.tuple([zList]),
		([rest]) => {
			const opts = plistOptions(rest, INPUT_OPTIONS);
			const name = stringOption(opts, "name");
			if (name === undefined)
				throw new EvalException("ui/input needs a :name", rest);
			return new UiElement(
				"input",
				withOptions({ name }, opts, ["label", "placeholder", "value"]),
			);
		},
		INPUT_ARGS,
	);

	interp.def(
		"ui/select",
		-2,
		'(ui/select options :name "n" [:label "…"] [:value "…"] [:on-change fn])',
		"A dropdown over `options`, a list of strings. Its `:name` is the key the chosen option arrives under in a handler. `:on-change` is a function of one argument run the moment the user picks something — the way to build a filter that needs no submit button, since it receives the same alist a form's handler would and answers the same way, by rendering.",
		z.tuple([zAny, zList]),
		([options, rest]) => {
			const opts = plistOptions(rest, SELECT_OPTIONS);
			const name = stringOption(opts, "name");
			if (name === undefined)
				throw new EvalException("ui/select needs a :name", rest);
			const items = listElements(options);
			if (items === undefined)
				throw new EvalException("list of options expected", options);
			const props = withOptions(
				{
					name,
					options: items.map((i) =>
						typeof i === "string" ? i : str(i, false),
					),
				},
				opts,
				["label", "value"],
			);
			const onChange = actionOption(surface, opts, "on-change");
			if (onChange !== undefined) props["on-change"] = onChange;
			return new UiElement("select", props);
		},
	);

	interp.def(
		"ui/checkbox",
		-1,
		'(ui/checkbox :name "open" [:label "…"] [:checked t] [:on-change fn])',
		'A tick box. Unlike a text field its value arrives as a real boolean, so `(if (cdr (assoc "open" values)) …)` works — where a `ui/input` would hand you the string "false", which is TRUE in Lisp. `:on-change` acts the moment it is ticked; without one it is read at submit like any other field.',
		z.tuple([zList]),
		([rest]) => {
			const opts = plistOptions(rest, CHECKBOX_OPTIONS);
			const name = stringOption(opts, "name");
			if (name === undefined)
				throw new EvalException("ui/checkbox needs a :name", rest);
			const props: Record<string, UiValue> = withOptions({ name }, opts, [
				"label",
			]);
			const checked = booleanOption(opts, "checked");
			if (checked !== undefined) props.checked = checked;
			const onChange = actionOption(surface, opts, "on-change");
			if (onChange !== undefined) props["on-change"] = onChange;
			return new UiElement("checkbox", props);
		},
	);

	interp.def(
		"ui/form",
		-2,
		'(ui/form action child... [:submit "Send"])',
		"A group of fields with a submit button. `action` is a function of ONE argument, run in this REPL when the user submits: it receives an alist of every enclosed field's `:name` and its current contents, read with `assoc`. Whatever it renders replaces the view.",
		z.tuple([zAny, zList]),
		([action, rest]) => {
			const { values, options } = splitKeywordArgs(rest, ["submit"]);
			const opts = plistOptions(options, ["submit"]);
			return new UiElement(
				"form",
				withOptions({ action: surface.action(action) }, opts, ["submit"]),
				childNodes(values),
			);
		},
	);

	interp.def(
		"ui/table",
		-2,
		'(ui/table rows [:columns \'("id" "title")])',
		`A table over \`rows\`, a list of alists. Without :columns every key of the first row is a column, in its own order. Draws at most ${MAX_ROWS} rows — \`head\` the list first if it is longer.`,
		z.tuple([zAny, zList]),
		([rows, rest]) => {
			const opts = plistOptions(rest, ["columns"]);
			const items = listElements(rows);
			if (items === undefined)
				throw new EvalException("list of rows expected", rows);
			const drawn = items.slice(0, MAX_ROWS).map(toJson);
			const named = opts.has("columns")
				? listElements(opts.get("columns"))?.map((c) =>
						typeof c === "string" ? c : str(c, false),
					)
				: undefined;
			const first = drawn[0];
			const columns =
				named ??
				(first !== null && typeof first === "object" && !Array.isArray(first)
					? Object.keys(first)
					: []);
			return new UiElement("table", { columns, rows: drawn });
		},
	);

	interp.def(
		"ui/send",
		-1,
		"(ui/send text...)",
		'Send a message to the agent from inside a handler, as if the user had typed it: it joins the conversation as a user turn and the agent answers it. This is how a click hands work BACK to the model — a form whose contents are a request rather than a filter, a button that means "now go do it". Arguments are joined like `echo`\'s, so build the message from the field values: (ui/send "search the issues for " (cdr (assoc "q" values))). A handler may render AND send; only handlers deliver, so calling this outside one does nothing.',
		z.tuple([zList]),
		([rest]) => {
			const parts = (listElements(rest) ?? []).map((x) =>
				typeof x === "string" ? x : str(x, false),
			);
			surface.send(parts.join(" "));
			return Unspecified;
		},
	);

	interp.def(
		"ui/render",
		1,
		"(ui/render view)",
		"Put a widget on the user's screen, replacing whatever this step rendered before. Returns a one-line summary, because the view is for the USER to read — describing it back to yourself would spend the context the widget just saved.",
		z.tuple([zAny]),
		([view]) => {
			if (!(view instanceof UiElement))
				throw new EvalException("ui element expected", view);
			surface.render(view);
			const { elements, actions } = summarize(view);
			return `rendered ${view.tag}, ${elements} element${elements === 1 ? "" : "s"}, ${actions} action${actions === 1 ? "" : "s"}`;
		},
	);
}

export function uiExtension(
	surface: UiSurface = new UiSurface(),
): InterpExtension {
	return (interp: Interp): void => registerUi(interp, surface);
}
