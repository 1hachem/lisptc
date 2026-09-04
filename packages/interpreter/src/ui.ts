/*
 * Generative UI for Lisptc.
 *
 * The compression extension's bargain is that the REPL describes values instead
 * of printing them, and `echo` is the one way anything reaches the screen. This
 * extension adds the other half: a way to put a value on the screen as an
 * *interactive* thing rather than as text.
 *
 * `(ui/render view)` publishes a widget tree the host serialises to JSON and a
 * frontend draws. The tree may carry Lisp callables — a button's action, a
 * form's submit handler — which never leave the interpreter: each one is
 * registered here under an opaque id (`a1`, `a2`, …) and only the id is
 * serialised. When the user clicks, the host calls `invoke` with that id, the
 * closure runs in this same interpreter with all its state intact, and whatever
 * it renders becomes the new view.
 *
 * So the loop is: the model writes Lisp that BUILDS a UI, the user drives that
 * UI, and driving it runs more Lisp — without another model turn. That is the
 * point: an interaction the model already anticipated costs no tokens at all.
 *
 * `(ui/send text)` is the way back out of that arrangement. A handler that hits
 * something it cannot answer on its own — the user typed a request rather than a
 * filter, the choice needs judgement — puts a message in the conversation and the
 * agent takes the next turn. The widget's actions are the cheap path; `ui/send`
 * is the escape hatch to the expensive one, chosen by the handler at click time
 * rather than by the model in advance.
 *
 * Like the compression and secrets extensions this one is opt-in and standalone
 * (no cross-imports between extensions). The `UiSurface` is created by the host
 * per interpreter — the handlers close over that interpreter's environment, so
 * they must die with it, exactly as the `Compressor`'s counters do.
 */
import { z } from "zod";
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

// Actions kept live at once. A handler is only reachable from a view the user
// can still see, but nothing tells us when a view leaves the screen, so the map
// would otherwise grow for the life of the interpreter. Oldest ids go first;
// clicking a button in a very old view reports a dead action rather than
// silently doing nothing.
const MAX_HANDLERS = 500;

// Rows `ui/table` will draw. A table is for looking at, not for paging through:
// past this the view is unreadable and the JSON is large.
const MAX_ROWS = 200;

// Characters a click may send back into the conversation. A sent message becomes
// a user turn, so it lands in the model's context and stays there — the one place
// in this extension where a runaway handler would cost real tokens on every
// subsequent turn. Roughly the echo cap's worth of text.
const MAX_MESSAGE_CHARS = 4000;

/** A JSON-serialisable value, which is all a widget tree may contain. */
export type UiValue =
	| string
	| number
	| boolean
	| null
	| UiValue[]
	| { [key: string]: UiValue };

/** One widget. `props.action` holds a handler id, never a closure. */
export interface UiNode {
	tag: string;
	props: Record<string, UiValue>;
	children: UiNode[];
}

// A widget as a Lisp value. Opaque on purpose: the model builds trees with the
// constructors and never picks them apart, so there is nothing to gain from
// making it an alist the agent could half-edit into an invalid shape.
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

/*
 * The rendered view and the live action handlers for one interpreter.
 *
 * Held by the host (the REPL), not by the interpreter: the host is what reads
 * `takeView()` after an eval and what routes a click back to `invoke()`.
 */
export class UiSurface {
	private readonly handlers = new Map<string, unknown>();
	private readonly outbox: string[] = [];
	private interp: Interp | undefined;
	private view: UiNode | undefined;
	private seq = 0;

	// Called by the extension as it installs itself, so `invoke` has an
	// interpreter to run the handler in.
	bind(interp: Interp): void {
		this.interp = interp;
	}

	/** Register a callable and return the id that stands for it on the wire. */
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
		this.view = node;
	}

	send(text: string): void {
		this.outbox.push(text);
	}

	/*
	 * What this step asked to say to the agent, as one message.
	 *
	 * Several `ui/send` calls in one handler join into a single turn rather than
	 * becoming several: a click is one thing the user did, and answering it as a
	 * conversation of its own would read as the widget talking to itself. Reads
	 * and clears, so a message is delivered once.
	 */
	takeMessage(): string | undefined {
		if (this.outbox.length === 0) return undefined;
		const text = this.outbox.join("\n\n");
		this.outbox.length = 0;
		if (text.length <= MAX_MESSAGE_CHARS) return text;
		// Truncated rather than refused: the click already happened, and a turn
		// that says most of what was meant beats one that says nothing.
		return `${text.slice(0, MAX_MESSAGE_CHARS)}\n… (message truncated)`;
	}

	/*
	 * The view rendered since the last call, if any.
	 *
	 * Reads and clears, so a step that rendered nothing reports nothing and the
	 * previous view stays on screen rather than being redrawn as this step's.
	 */
	takeView(): UiNode | undefined {
		const v = this.view;
		this.view = undefined;
		return v;
	}

	hasAction(id: string): boolean {
		return this.handlers.has(id);
	}

	/*
	 * Run the handler behind `id` with the submitted field values.
	 *
	 * The values are passed only to a handler that takes an argument, so
	 * `(lambda () …)` — the natural way to write a button that needs no input —
	 * is not an arity error. Anything the handler renders is picked up by the
	 * caller through `takeView`.
	 */
	invoke(id: string, values: Record<string, unknown>): unknown {
		const fn = this.handlers.get(id);
		if (fn === undefined)
			throw new EvalException("no such ui action", id, false);
		const interp = this.interp;
		if (interp === undefined)
			throw new EvalException("ui surface is not bound to an interpreter", id);
		const arity = callableArity(fn);
		const takesValues = arity !== undefined && (arity.max ?? 1) > 0;
		// Quoted, because a call form's arguments are evaluated: the alist would
		// otherwise be read as a function call on its first pair.
		const args: List = takesValues
			? new Cell(quoted(jsonToLisp(values)), null)
			: null;
		return interp.eval(new Cell(fn, args), null);
	}
}

// `(quote x)`, so `x` reaches a callee as data rather than as an expression.
function quoted(x: unknown): unknown {
	return new Cell(newSym("quote"), new Cell(x, null));
}

const zString = z.custom<string>(
	(x) => typeof x === "string",
	"string expected",
);

// The elements of a proper list, or undefined for anything that is not one.
function listElements(x: unknown): unknown[] | undefined {
	if (x === null) return [];
	if (!(x instanceof Cell)) return undefined;
	const out: unknown[] = [];
	for (let p: unknown = x; p instanceof Cell; p = p.cdr) out.push(p.car);
	return out;
}

// A Lisp value as JSON for the wire. Deliberately narrower than the MCP layer's
// conversion: a widget tree holds display data, so anything exotic is rendered
// with `str` rather than given a structural encoding the frontend cannot draw.
function toJson(x: unknown): UiValue {
	if (x === null || x === undefined) return null;
	if (x === true) return true;
	if (typeof x === "number") return x;
	if (typeof x === "bigint") return Number(x);
	if (typeof x === "string") return x;
	if (x instanceof UiElement) return nodeToJson(x);
	const items = listElements(x);
	if (items !== undefined) {
		// An alist — every element a (string . value) pair — is an object; any
		// other list is an array.
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

/** A widget tree as plain JSON, ready to serialise to a frontend. */
export function nodeToJson(node: UiNode): UiValue {
	return {
		tag: node.tag,
		props: node.props,
		children: node.children.map(nodeToJson),
	};
}

// Widget children: every non-keyword argument, each of which must be a widget.
// A bare string is lifted into `ui/text`, since writing `(ui/stack "hello")` is
// the obvious thing to reach for and failing it teaches nothing.
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

// Only the options actually given become props, so the frontend can tell "no
// placeholder" from "an empty placeholder" without a sentinel.
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

// How many widgets and how many live actions a tree holds — the whole of what
// the model is told about a view it just rendered.
function summarize(node: UiNode): { elements: number; actions: number } {
	let elements = 1;
	let actions = typeof node.props.action === "string" ? 1 : 0;
	for (const child of node.children) {
		const sub = summarize(child);
		elements += sub.elements;
		actions += sub.actions;
	}
	return { elements, actions };
}

const INPUT_OPTIONS = ["name", "label", "placeholder", "value"];
const SELECT_OPTIONS = ["name", "label", "value"];

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
		'(ui/select options :name "n" [:label "…"] [:value "…"])',
		"A dropdown over `options`, a list of strings. Its `:name` is the key the chosen option arrives under in the enclosing form's handler.",
		z.tuple([zAny, zList]),
		([options, rest]) => {
			const opts = plistOptions(rest, SELECT_OPTIONS);
			const name = stringOption(opts, "name");
			if (name === undefined)
				throw new EvalException("ui/select needs a :name", rest);
			const items = listElements(options);
			if (items === undefined)
				throw new EvalException("list of options expected", options);
			return new UiElement(
				"select",
				withOptions(
					{
						name,
						options: items.map((i) =>
							typeof i === "string" ? i : str(i, false),
						),
					},
					opts,
					["label", "value"],
				),
			);
		},
	);

	interp.def(
		"ui/form",
		-2,
		'(ui/form action child... [:submit "Send"])',
		"A group of fields with a submit button. `action` is a function of ONE argument, run in this REPL when the user submits: it receives an alist of every enclosed field's `:name` and its current contents, read with `assoc`. Whatever it renders replaces the view.",
		z.tuple([zAny, zList]),
		([action, rest]) => {
			const { values, options } = splitKeywordArgs(rest);
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

/*
 * Install the `ui/*` built-ins over `surface`.
 *
 * The host passes the same `UiSurface` it reads views and routes clicks
 * through, and creates a new one per interpreter: a registered action is a
 * closure over that interpreter's environment, so it must not outlive a
 * `reset()`. (Same rule as `compressionExtension`, the opposite of
 * `secretsExtension`, whose store is host configuration.)
 */
export function uiExtension(
	surface: UiSurface = new UiSurface(),
): InterpExtension {
	return (interp: Interp): void => registerUi(interp, surface);
}
