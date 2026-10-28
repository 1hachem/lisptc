import type { DocArg } from "@repo/interpreter/docs";
import { EvalException } from "@repo/interpreter/errors";
import type { List } from "@repo/interpreter/objects";
import { plistOptions, splitKeywordArgs } from "@repo/interpreter/plist";
import { str } from "@repo/interpreter/print";
import { zAny, zList } from "@repo/interpreter/schema";
import { FOLDERS, TAGS, type Tag, TONES } from "@repo/ui-catalog";
import { z } from "zod";
import {
	childNodes,
	type Draft,
	listElements,
	printed,
	toJson,
} from "./element.ts";
import type { UiNode } from "./view.ts";

const MAX_ROWS = 200;

export interface Built<T extends Tag> {
	props: Draft<T>;
	children?: UiNode[];
}

export interface WidgetForm<T extends Tag> {
	arity: number;
	signature: string;
	brief: string;
	example: string;
	doc: string;
	args: z.ZodType<unknown[]>;
	docArgs?: DocArg[];
	nameable?: boolean;
	build(args: never, action: (fn: unknown) => string): Built<T>;
}

function form<T extends Tag, A extends unknown[]>(
	spec: Omit<WidgetForm<T>, "build" | "args"> & {
		args: z.ZodType<A>;
		build(args: A, action: (fn: unknown) => string): Built<T>;
	},
): WidgetForm<T> {
	return spec as WidgetForm<T>;
}

export const zString = z.custom<string>(
	(x) => typeof x === "string",
	"string expected",
);

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

function booleanOption(
	opts: Map<string, unknown>,
	name: string,
): boolean | undefined {
	if (!opts.has(name)) return undefined;
	return opts.get(name) !== null;
}

function named(opts: Map<string, unknown>, tag: string, rest: List): string {
	const name = stringOption(opts, "name");
	if (name === undefined)
		throw new EvalException(`ui/${tag} needs a :name`, rest);
	return name;
}

function arg(name: string, type: string, description: string): DocArg {
	return { name, type, required: false, description };
}

type WidgetForms = { [T in Tag]: WidgetForm<T> };

export const WIDGET_FORMS: WidgetForms = {
	text: form({
		arity: 1,
		signature: "(ui/text s)",
		brief: "a line.",
		example: '(ui/text "hello")',
		doc: "A line of text. The plainest widget: use it for anything you would otherwise echo.",
		args: z.tuple([zAny]),
		build: ([s]) => ({ props: { text: typeof s === "string" ? s : str(s) } }),
	}),
	heading: form({
		arity: 1,
		signature: "(ui/heading s)",
		brief: "heading for section under it.",
		example: '(ui/heading "Open issues")',
		doc: "A heading for the section under it.",
		args: z.tuple([zString]),
		build: ([s]) => ({ props: { text: s } }),
	}),
	markdown: form({
		arity: 1,
		signature: "(ui/markdown s)",
		brief: "markdown block.",
		example: '(ui/markdown "**done**")',
		doc: "A block of markdown, rendered as markdown. Use it for prose; use `ui/table` for data.",
		args: z.tuple([zString]),
		build: ([s]) => ({ props: { text: s } }),
	}),
	link: form({
		arity: 2,
		signature: "(ui/link text url)",
		brief:
			"opens in new tab. Use for URL a tool handed you, so user follows it, not copies it from a table.",
		example: '(ui/link "PR" "https://example.com/pr/1")',
		doc: "A link, opened in a new tab. Both arguments are nameable, so `(ui/link :url u :text label)` is the same call. Nothing runs in the REPL — this is the one interactive widget with no handler. Use it for a URL a tool handed you (an issue, a PR, a dashboard) so the user can follow it instead of copying it out of a table.",
		args: z.tuple([zString, zString]),
		docArgs: [
			arg("text", "string", "what the link reads as"),
			arg("url", "string", "where it goes"),
		],
		nameable: true,
		build: ([text, url]) => ({ props: { text, href: url } }),
	}),
	"file-link": form({
		arity: 3,
		signature: "(ui/file-link text folder name)",
		brief:
			'click opens file in panel tab. Folder is "attachments" or "knowledge".',
		example: '(ui/file-link "Q3 report" "knowledge" "q3.pdf")',
		doc: `A link to a stored file. \`folder\` is one of ${FOLDERS.join(" ")}. A click opens the file's preview in a tab of the panel beside the chat, the way \`ui/open-file\` would. Put several in a \`ui/stack\` to list files the user can open.`,
		args: z.tuple([zString, zString, zString]),
		build: ([text, folder, name]) => ({
			props: { text, folder: folder as (typeof FOLDERS)[number], name },
		}),
	}),
	badge: form({
		arity: -2,
		signature: '(ui/badge text [:tone "ok"])',
		brief:
			'short status label. :tone only "ok", "warn", "bad", "info" or "muted"; any other tone is an error, do not invent one. For *state*: status, severity, check result, where a sentence is noise.',
		example: '(ui/badge "open" :tone "ok")',
		doc: `A short status label. \`:tone\` is one of ${TONES.join(" ")} and colours it; without one it draws plain. For the state of a thing — an issue's status, a check's result, a severity — where a whole sentence would be noise.`,
		args: z.tuple([zString, zList]),
		build: ([text, rest]) => ({
			props: {
				text,
				tone: stringOption(plistOptions(rest, ["tone"]), "tone") as
					| (typeof TONES)[number]
					| undefined,
			},
		}),
	}),
	kpi: form({
		arity: 3,
		signature: '(ui/kpi label value [:hint "…"])',
		brief:
			'one big number, as in (ui/kpi "open" 27). Most understanding per token: a glance says what a 27-row table says in a screenful. :hint is smaller line under it.',
		example: '(ui/kpi "open" 27)',
		doc: 'One number, big. The most understanding per token of anything here: `(ui/kpi "open" 27)` says at a glance what a 27-row table says in a screenful. `:hint` is a smaller line under it — a comparison, a unit, a caveat. Every argument is nameable, so `(ui/kpi :value 27 :label "open")` is the same call.',
		args: z.tuple([zString, zAny, zAny]),
		docArgs: [
			arg("label", "string", "what the number counts"),
			arg("value", "any", "the number itself"),
			arg("hint", "string", "a smaller line under it"),
		],
		nameable: true,
		build: ([label, value, hint]) => {
			if (hint !== null && typeof hint !== "string")
				throw new EvalException("string expected for :hint", hint);
			return {
				props: { label, value: printed(value), hint: hint ?? undefined },
			};
		},
	}),
	stack: form({
		arity: -1,
		signature: "(ui/stack child...)",
		brief: "stacked. Bare string child becomes ui/text.",
		example: '(ui/stack "a" "b")',
		doc: "Lay the widgets out one above the next. A bare string child becomes `ui/text`.",
		args: z.tuple([zList]),
		build: ([rest]) => ({ props: {}, children: childNodes(rest) }),
	}),
	row: form({
		arity: -1,
		signature: "(ui/row child...)",
		brief: "side by side. Bare string child becomes ui/text.",
		example: '(ui/row "a" "b")',
		doc: "Lay the widgets out side by side. A bare string child becomes `ui/text`.",
		args: z.tuple([zList]),
		build: ([rest]) => ({ props: {}, children: childNodes(rest) }),
	}),
	card: form({
		arity: -2,
		signature: "(ui/card title child...)",
		brief:
			"titled box. Split long view into named parts; big ui/stack without cards reads as one wall.",
		example: '(ui/card "Summary" "all green")',
		doc: "A titled box around the widgets. Use it to break a view into named parts — a long `ui/stack` with no cards reads as one wall of things.",
		args: z.tuple([zString, zList]),
		build: ([title, rest]) => ({
			props: { title },
			children: childNodes(rest),
		}),
	}),
	button: form({
		arity: 2,
		signature: "(ui/button label action)",
		brief: "runs action on click. Action is fn or quoted call like '(refresh).",
		example: '(ui/button "refresh" (lambda () nil))',
		doc: "A button. Both arguments are nameable, so `(ui/button :action (lambda () …) :label caption)` is the same call. `action` is a function run IN THIS REPL when the user clicks it — with no model turn in between, so a button is how you offer something without spending a step on it. Write it as `(lambda () …)`; inside a `ui/form` write `(lambda (values) …)` to receive the fields. It may instead be a quoted call to a global function, `'(refresh-dashboard)` or `'(set-filter \"open\")`: it outlives a REPL restart, and the field alist is appended when the function takes one more argument. Whatever the action renders replaces the view.",
		args: z.tuple([zString, zAny]),
		docArgs: [
			arg("label", "string", "what the button reads as"),
			arg("action", "function or quoted call", "what running it does"),
		],
		nameable: true,
		build: ([label, fn], action) => ({ props: { label, action: action(fn) } }),
	}),
	input: form({
		arity: -1,
		signature:
			'(ui/input :name "q" [:label "Search"] [:placeholder "…"] [:value ""])',
		brief: "text field.",
		example: '(ui/input :name "q" :label "filter")',
		doc: "A text field. Its `:name` is the key its contents arrive under in the enclosing form's handler.",
		args: z.tuple([zList]),
		docArgs: [
			{
				name: "name",
				type: "string",
				required: true,
				description: "the key this field's value arrives under in the handler",
			},
			arg("label", "string", "text shown beside the field"),
			arg("placeholder", "string", "hint text shown while the field is empty"),
			arg("value", "string", "the field's initial contents"),
		],
		build: ([rest]) => {
			const opts = plistOptions(rest, [
				"name",
				"label",
				"placeholder",
				"value",
			]);
			return {
				props: {
					name: named(opts, "input", rest),
					label: stringOption(opts, "label"),
					placeholder: stringOption(opts, "placeholder"),
					value: stringOption(opts, "value"),
				},
			};
		},
	}),
	select: form({
		arity: -2,
		signature:
			'(ui/select options :name "n" [:label "…"] [:value "…"] [:on-change fn])',
		brief: "dropdown over strings.",
		example: '(ui/select \'("7" "30") :name "d")',
		doc: "A dropdown over `options`, a list of strings. Its `:name` is the key the chosen option arrives under in a handler. `:on-change` is a function of one argument, or a quoted call as for `ui/button`, run the moment the user picks something — the way to build a filter that needs no submit button, since it receives the same alist a form's handler would and answers the same way, by rendering.",
		args: z.tuple([zAny, zList]),
		build: ([choices, rest], action) => {
			const opts = plistOptions(rest, ["name", "label", "value", "on-change"]);
			const name = named(opts, "select", rest);
			const items = listElements(choices);
			if (items === undefined)
				throw new EvalException("list of options expected", choices);
			return {
				props: {
					name,
					options: items.map(printed),
					label: stringOption(opts, "label"),
					value: stringOption(opts, "value"),
					"on-change": opts.has("on-change")
						? action(opts.get("on-change"))
						: undefined,
				},
			};
		},
	}),
	checkbox: form({
		arity: -1,
		signature:
			'(ui/checkbox :name "open" [:label "…"] [:checked t] [:on-change fn])',
		brief: "tick box.",
		example: '(ui/checkbox :name "o" :label "open only")',
		doc: 'A tick box. Unlike a text field its value arrives as a real boolean, so `(if (cdr (assoc "open" values)) …)` works — where a `ui/input` would hand you the string "false", which is TRUE in Lisp. `:on-change`, a function or a quoted call as for `ui/button`, acts the moment it is ticked; without one it is read at submit like any other field.',
		args: z.tuple([zList]),
		build: ([rest], action) => {
			const opts = plistOptions(rest, [
				"name",
				"label",
				"checked",
				"on-change",
			]);
			return {
				props: {
					name: named(opts, "checkbox", rest),
					label: stringOption(opts, "label"),
					checked: booleanOption(opts, "checked"),
					"on-change": opts.has("on-change")
						? action(opts.get("on-change"))
						: undefined,
				},
			};
		},
	}),
	form: form({
		arity: -2,
		signature: '(ui/form action child... [:submit "Send"])',
		brief: "fields with submit button.",
		example: '(ui/form (lambda (values) nil) (ui/input :name "q"))',
		doc: "A group of fields with a submit button. `action` is a function of ONE argument, or a quoted call as for `ui/button`, run in this REPL when the user submits: it receives an alist of every enclosed field's `:name` and its current contents, read with `assoc`. Whatever it renders replaces the view.",
		args: z.tuple([zAny, zList]),
		build: ([fn, rest], action) => {
			const { values, options: given } = splitKeywordArgs(rest, ["submit"]);
			return {
				props: {
					action: action(fn),
					submit: stringOption(plistOptions(given, ["submit"]), "submit"),
				},
				children: childNodes(values),
			};
		},
	}),
	table: form({
		arity: -2,
		signature: '(ui/table rows [:columns \'("id" "title")])',
		brief:
			"rows is list of alists, usual MCP result shape. No :columns: first row's keys are columns.",
		example: '(ui/table \'((("id" . 1) ("title" . "a"))))',
		doc: `A table over \`rows\`, a list of alists. Without :columns every key of the first row is a column, in its own order. Draws at most ${MAX_ROWS} rows — \`head\` the list first if it is longer.`,
		args: z.tuple([zAny, zList]),
		build: ([rows, rest]) => {
			const opts = plistOptions(rest, ["columns"]);
			const items = listElements(rows);
			if (items === undefined)
				throw new EvalException("list of rows expected", rows);
			const drawn = items.slice(0, MAX_ROWS).map(toJson);
			const named = opts.has("columns")
				? listElements(opts.get("columns"))?.map(printed)
				: undefined;
			const first = drawn[0];
			const columns =
				named ??
				(first !== null && typeof first === "object" && !Array.isArray(first)
					? Object.keys(first)
					: []);
			return { props: { columns, rows: drawn } };
		},
	}),
};

export function widgetPromptSection(): string {
	return [
		"**Constructors** each return a widget; none draws on its own.",
		...TAGS.map(
			(tag) => `- ${WIDGET_FORMS[tag].signature} ${WIDGET_FORMS[tag].brief}`,
		),
	].join("\n");
}
