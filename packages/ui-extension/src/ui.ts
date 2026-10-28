import {
	annotate,
	type ViewNode,
	viewKey,
} from "@repo/interpreter/annotations";
import { type Channels, topic } from "@repo/interpreter/channels";
import type { DocArg } from "@repo/interpreter/docs";
import { driveAsync, type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import { BuiltInFunc, callableArity } from "@repo/interpreter/func";
import type { Interp, State, StateCodec } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	jsonToLisp,
	type List,
	listToArray,
	newLispKeyword,
	newSym,
	Unspecified,
} from "@repo/interpreter/objects";
import { plistOptions, splitKeywordArgs } from "@repo/interpreter/plist";
import { str } from "@repo/interpreter/print";
import { zAny, zList } from "@repo/interpreter/schema";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import type { PromptSource } from "@repo/shared/host";
import { ACTION_PROPS, FOLDERS, TONES } from "@repo/ui-catalog";
import { z } from "zod";
import {
	type Folder,
	fileTab,
	type PanelOp,
	type PanelStore,
	type PanelTab,
	SPLITS,
	type Split,
	viewTab,
} from "./panel.ts";
import type { UiNode, UiValue } from "./view.ts";

export {
	fileTab,
	type PanelContent,
	type PanelOp,
	type PanelStore,
	type PanelTab,
	viewTab,
} from "./panel.ts";
export type { UiNode, UiValue } from "./view.ts";

const MAX_HANDLERS = 500;

const MAX_ROWS = 200;

const MAX_MESSAGE_CHARS = 4000;

export function joinMessages(parts: readonly string[]): string | undefined {
	if (parts.length === 0) return undefined;
	const text = parts.join("\n\n");
	if (text.length <= MAX_MESSAGE_CHARS) return text;
	return `${text.slice(0, MAX_MESSAGE_CHARS)}\n… (message truncated)`;
}

export const rendered = topic<UiNode>("ui");

export const sent = topic<string>("ui-send");

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

const handlerCodec: StateCodec<[string, unknown][]> = {
	toLisp: (handlers) =>
		arrayToList(handlers.map(([id, fn]) => new Cell(id, fn))),
	fromLisp: (list) =>
		listToArray(list as List).map((pair) => [
			(pair as Cell).car as string,
			(pair as Cell).cdr,
		]),
};

const seqCodec: StateCodec<number> = {
	toLisp: (n) => BigInt(n),
	fromLisp: (x) => Number(x),
};

const UI_TAG = "ui/element";

export class UiSurface {
	private handlers: State<[string, unknown][]> | undefined;
	private seq: State<number> | undefined;
	private interp: Interp | undefined;
	private channels: Channels | undefined;

	bind(interp: Interp): void {
		this.interp = interp;
		this.channels = interp.channels;
		this.handlers = interp.state(
			"ui/handlers",
			handlerCodec,
			[],
			"The function behind each control on screen, by the action id the view carries. The oldest are dropped past 500.",
		);
		this.seq = interp.state(
			"ui/seq",
			seqCodec,
			0,
			"The number of the last action id handed out.",
		);
	}

	reset(): void {
		this.handlers?.set([]);
	}

	action(fn: unknown): string {
		if (callableArity(fn) === undefined)
			throw new EvalException("function expected as a ui action", fn);
		const n = (this.seq?.get() ?? 0) + 1;
		this.seq?.set(n);
		const id = `a${n}`;
		const handlers = [
			...(this.handlers?.get() ?? []),
			[id, fn] as [string, unknown],
		];
		this.handlers?.set(handlers.slice(-MAX_HANDLERS));
		return id;
	}

	drop(ids: readonly string[]): number {
		const held = this.handlers?.get() ?? [];
		const kept = held.filter(([id]) => !ids.includes(id));
		this.handlers?.set(kept);
		return held.length - kept.length;
	}

	private handler(id: string): unknown {
		return this.handlers?.get().find(([at]) => at === id)?.[1];
	}

	render(node: UiNode): void {
		const channels = this.channels;
		if (channels) rendered.emit(channels, { user: node });
	}

	send(text: string): void {
		const channels = this.channels;
		if (channels) sent.emit(channels, { model: text });
	}

	hasAction(id: string): boolean {
		return this.handler(id) !== undefined;
	}

	async invoke(id: string, values: Record<string, unknown>): Promise<unknown> {
		const fn = this.handler(id);
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
		const { value } = await driveAsync(
			interp.evalGen(new Cell(fn, args), null),
		);
		return value;
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

function viewOf(node: UiNode): ViewNode {
	return {
		tag: node.tag,
		props: node.props,
		children: node.children.map(viewOf),
	};
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

function namesOf(args: DocArg[]): string[] {
	return args.map((arg) => arg.name);
}

const KPI_ARGS: DocArg[] = [
	{
		name: "label",
		type: "string",
		required: false,
		description: "what the number counts",
	},
	{
		name: "value",
		type: "any",
		required: false,
		description: "the number itself",
	},
	{
		name: "hint",
		type: "string",
		required: false,
		description: "a smaller line under it",
	},
];

const LINK_ARGS: DocArg[] = [
	{
		name: "text",
		type: "string",
		required: false,
		description: "what the link reads as",
	},
	{
		name: "url",
		type: "string",
		required: false,
		description: "where it goes",
	},
];

const BUTTON_ARGS: DocArg[] = [
	{
		name: "label",
		type: "string",
		required: false,
		description: "what the button reads as",
	},
	{
		name: "action",
		type: "function",
		required: false,
		description: "what running it does",
	},
];

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

function actionsOf(node: UiNode): string[] {
	const own = ACTION_PROPS.map((prop) => node.props[prop]).filter(
		(id): id is string => typeof id === "string",
	);
	return [...own, ...node.children.flatMap(actionsOf)];
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

function folderOf(folder: string): Folder {
	if (!(FOLDERS as readonly string[]).includes(folder))
		throw new EvalException(
			`unknown folder; expected one of ${FOLDERS.join(" ")}`,
			folder,
		);
	return folder as Folder;
}

function splitOf(opts: Map<string, unknown>): Split {
	const split = stringOption(opts, "split") ?? "here";
	if (!(SPLITS as readonly string[]).includes(split))
		throw new EvalException(
			`unknown split; expected one of ${SPLITS.join(" ")}`,
			split,
		);
	return split as Split;
}

function elementOf(node: UiNode): UiElement {
	return new UiElement(node.tag, node.props, node.children.map(elementOf));
}

function tabList(tab: PanelTab): List {
	return arrayToList([
		newLispKeyword("id"),
		tab.id,
		newLispKeyword("kind"),
		newLispKeyword(tab.kind),
		newLispKeyword("title"),
		tab.title,
		newLispKeyword("shown"),
		tab.shown || null,
		newLispKeyword("focused"),
		tab.focused || null,
	]);
}

function registerUi(
	interp: Interp,
	surface: UiSurface,
	panel: PanelStore,
): void {
	surface.bind(interp);
	surface.reset();
	interp.recovery.kind({
		name: UI_TAG,
		claims: (x) => x instanceof UiElement,
		save: (x) => nodeToJson(x as UiElement),
		restore: (data) => elementOf(data as UiNode),
	});

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
		"A link, opened in a new tab. Both arguments are nameable, so `(ui/link :url u :text label)` is the same call. Nothing runs in the REPL — this is the one interactive widget with no handler. Use it for a URL a tool handed you (an issue, a PR, a dashboard) so the user can follow it instead of copying it out of a table.",
		z.tuple([zString, zString]),
		([text, url]) => new UiElement("link", { text, href: url }),
		LINK_ARGS,
		namesOf(LINK_ARGS),
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
		3,
		'(ui/kpi label value [:hint "…"])',
		'One number, big. The most understanding per token of anything here: `(ui/kpi "open" 27)` says at a glance what a 27-row table says in a screenful. `:hint` is a smaller line under it — a comparison, a unit, a caveat. Every argument is nameable, so `(ui/kpi :value 27 :label "open")` is the same call.',
		z.tuple([zString, zAny, zAny]),
		([label, value, hint]) => {
			const props: Record<string, UiValue> = {
				label,
				value: typeof value === "string" ? value : str(value, false),
			};
			if (hint !== null) {
				if (typeof hint !== "string")
					throw new EvalException("string expected for :hint", hint);
				props.hint = hint;
			}
			return new UiElement("kpi", props);
		},
		KPI_ARGS,
		namesOf(KPI_ARGS),
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
		"A button. Both arguments are nameable, so `(ui/button :action (lambda () …) :label caption)` is the same call. `action` is a function run IN THIS REPL when the user clicks it — with no model turn in between, so a button is how you offer something without spending a step on it. Write it as `(lambda () …)`; inside a `ui/form` write `(lambda (values) …)` to receive the fields. Whatever the action renders replaces the view.",
		z.tuple([zString, zAny]),
		([label, action]) =>
			new UiElement("button", { label, action: surface.action(action) }),
		BUTTON_ARGS,
		namesOf(BUTTON_ARGS),
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
		"ui/file-link",
		3,
		"(ui/file-link text folder name)",
		`A link to a stored file. \`folder\` is one of ${FOLDERS.join(" ")}. A click opens the file's preview in a tab of the panel beside the chat, the way \`ui/open-file\` would. Put several in a \`ui/stack\` to list files the user can open.`,
		z.tuple([zString, zString, zString]),
		([text, folder, name]) =>
			new UiElement("file-link", { text, folder: folderOf(folder), name }),
	);

	function* emit(op: PanelOp): Eval<void> {
		yield* settled(panel.apply([op]));
	}

	interp.defGen(
		"ui/open-file",
		-3,
		'(ui/open-file folder name [:split "right"])',
		`Open a stored file's preview in a tab of the panel beside the chat. \`folder\` is one of ${FOLDERS.join(" ")}; list it first, since a name that is not there opens a tab that says so. \`:split\` is one of ${SPLITS.join(" ")}: here adds the tab to the focused split, right and down open a new split beside it. A file already open is focused instead. Returns the tab id.`,
		z.tuple([zString, zString, zList]),
		function* ([folder, name, rest]): Eval {
			const checked = folderOf(folder);
			const tab = fileTab(checked, name);
			yield* emit({
				op: "open",
				tab,
				split: splitOf(plistOptions(rest, ["split"])),
				content: { kind: "file", folder: checked, name },
			});
			return tab;
		},
	);

	interp.defGen(
		"ui/open-view",
		-3,
		'(ui/open-view title view [:split "right"])',
		`Open a widget in a tab of the panel beside the chat, titled \`title\`, instead of under your message. Its controls run in this REPL like any other view's. Opening the same title again replaces that tab. \`:split\` is as for \`ui/open-file\`. Returns the tab id.`,
		z.tuple([zString, zAny, zList]),
		function* ([title, view, rest]): Eval {
			if (!(view instanceof UiElement))
				throw new EvalException("ui element expected", view);
			const tab = viewTab(title);
			yield* emit({
				op: "open",
				tab,
				split: splitOf(plistOptions(rest, ["split"])),
				content: { kind: "view", title, node: nodeToJson(view) },
			});
			return tab;
		},
	);

	interp.defGen(
		"ui/close",
		1,
		"(ui/close tab)",
		"Close a panel tab by the id `ui/open-file`, `ui/open-view` or `ui/tabs` gave. A split left empty folds into its neighbour. Returns t if the tab was open, nil if it was not.",
		z.tuple([zString]),
		function* ([tab]): Eval {
			const tabs = yield* settled(panel.tabs());
			if (!tabs.some((open) => open.id === tab)) return null;
			yield* emit({ op: "close", tab });
			return true;
		},
	);

	interp.defGen(
		"ui/focus",
		1,
		"(ui/focus tab)",
		"Bring a panel tab to the front by the id `ui/open-file` or `ui/open-view` returned.",
		z.tuple([zString]),
		function* ([tab]): Eval {
			yield* emit({ op: "focus", tab });
			return Unspecified;
		},
	);

	interp.defGen(
		"ui/tabs",
		0,
		"(ui/tabs)",
		"Return the tabs open in the panel beside the chat, as a list of (:id id :kind kind :title title :shown t-or-nil :focused t-or-nil). :kind is :file, :view, :chat or :page. The user opens, closes and moves tabs too, so read this before closing or focusing a tab by an id from an earlier step.",
		z.tuple([]),
		function* (): Eval {
			const tabs = yield* settled(panel.tabs());
			return arrayToList(tabs.map(tabList));
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
			return renderView(surface, view);
		},
	);

	interp.def(
		"ui/forget",
		1,
		"(ui/forget view)",
		"Drop the handlers behind every control in `view`, so clicking them runs nothing any more. Use it on a view you replaced or closed. Returns how many were dropped.",
		z.tuple([zAny]),
		([view]) => {
			if (!(view instanceof UiElement))
				throw new EvalException("ui element expected", view);
			return BigInt(surface.drop(actionsOf(view)));
		},
	);

	const textEcho = interp.getGlobal(newSym("echo"));
	const textEchoDoc = interp.docs().get("echo");
	if (
		!(textEcho instanceof BuiltInFunc) ||
		textEcho.kind !== "plain" ||
		textEchoDoc === undefined
	)
		throw new Error("ui extension wraps a plain echo builtin");
	interp.def(
		"echo",
		-1,
		textEchoDoc.signature,
		`${textEchoDoc.doc} When any argument is a widget, the whole echo is rendered instead, as \`ui/render\` would: the widget alone, or a \`ui/stack\` of every argument in order with the rest as \`ui/text\`, and it returns the one-line summary \`ui/render\` returns.`,
		z.tuple([zList]),
		([rest]) => {
			const args = listElements(rest) ?? [];
			if (!args.some((x) => x instanceof UiElement))
				return textEcho.call([rest]);
			const nodes = args.map((x) =>
				x instanceof UiElement
					? x
					: new UiElement("text", {
							text: typeof x === "string" ? x : str(x, false),
						}),
			);
			const [only] = nodes;
			return renderView(
				surface,
				nodes.length === 1 && only !== undefined
					? only
					: new UiElement("stack", {}, nodes),
			);
		},
		textEchoDoc.args,
	);
}

function renderView(surface: UiSurface, view: UiElement): string {
	surface.render(view);
	const { elements, actions } = summarize(view);
	return `rendered ${view.tag}, ${elements} element${elements === 1 ? "" : "s"}, ${actions} action${actions === 1 ? "" : "s"}`;
}

export interface UiHost {
	prompt: PromptSource;
	panel: PanelStore;
}

export interface UiOptions {
	surface?: UiSurface;
}

export type UiExtension = InterpExtension & { surface: UiSurface };

export function uiExtension(
	host: UiHost,
	options: UiOptions = {},
): UiExtension {
	const surface = options.surface ?? new UiSurface();
	return Object.assign(
		(interp: Interp): void => registerUi(interp, surface, host.panel),
		{
			surface,
			prompt: host.prompt(),
			session(hooks: SessionHooks): void {
				hooks.invoke.use(async (ctx) => {
					await surface.invoke(ctx.action, ctx.values);
				});
				hooks.annotate.use((buffer, into, next) => {
					const view = buffer.collect(rendered).at(-1);
					return next(
						buffer,
						view === undefined ? into : annotate(into, viewKey, viewOf(view)),
					);
				});
				hooks.message.use(
					(buffer, next) => joinMessages(buffer.collect(sent)) ?? next(buffer),
				);
			},
		},
	);
}
