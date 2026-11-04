import { annotate, viewKey } from "@repo/interpreter/annotations";
import { type Channels, topic } from "@repo/interpreter/channels";
import { driveAsync, type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import { BuiltInFunc, callableArity } from "@repo/interpreter/func";
import type { Interp, State, StateCodec } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	jsonToLisp,
	Keyword,
	type List,
	listToArray,
	newLispKeyword,
	newSym,
	Sym,
	Unspecified,
} from "@repo/interpreter/objects";
import { plistOptions } from "@repo/interpreter/plist";
import { str } from "@repo/interpreter/print";
import { zAny, zList } from "@repo/interpreter/schema";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import type { PromptSource } from "@repo/shared/host";
import {
	ACTION_PROPS,
	FOLDERS,
	PAGE_IDS,
	pages,
	TAGS,
	type Tag,
} from "@repo/ui-catalog";
import { z } from "zod";
import {
	element,
	listElements,
	nodeToJson,
	textOf,
	UiElement,
} from "./element.ts";
import {
	type Folder,
	fileTab,
	type PanelOp,
	type PanelStore,
	type PanelTab,
	pageTab,
	SPLITS,
	type Split,
	viewTab,
} from "./panel.ts";
import {
	anchorPromptSection,
	pageOf,
	pagePromptSection,
	registerTours,
} from "./tour.ts";
import type { TourStore } from "./tour-store.ts";
import type { UiNode } from "./view.ts";
import type { ViewStore } from "./view-store.ts";
import { WIDGET_FORMS, widgetPromptSection, zString } from "./widgets.ts";

export { nodeToJson } from "./element.ts";
export {
	fileTab,
	type PanelContent,
	type PanelOp,
	type PanelStore,
	type PanelTab,
	pageTab,
	viewTab,
} from "./panel.ts";
export {
	MemoryTourStore,
	type StartedTour,
	type TourStore,
} from "./tour-store.ts";
export type { UiNode, UiValue } from "./view.ts";
export {
	MemoryViewStore,
	type StoredView,
	type ViewStore,
} from "./view-store.ts";

const MAX_HANDLERS = 500;

const MAX_MESSAGE_CHARS = 4000;

export function joinMessages(parts: readonly string[]): string | undefined {
	if (parts.length === 0) return undefined;
	const text = parts.join("\n\n");
	if (text.length <= MAX_MESSAGE_CHARS) return text;
	return `${text.slice(0, MAX_MESSAGE_CHARS)}\n… (message truncated)`;
}

export interface RenderedView {
	viewId: string;
	node: UiNode;
}

export const rendered = topic<RenderedView>("ui");

export const sent = topic<string>("ui-send");

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

const ownerCodec: StateCodec<[string, string][]> = {
	toLisp: (owners) =>
		arrayToList(owners.map(([action, view]) => new Cell(action, view))),
	fromLisp: (list) =>
		listToArray(list as List).map((pair) => [
			(pair as Cell).car as string,
			(pair as Cell).cdr as string,
		]),
};

const callCodec: StateCodec<[string, Cell][]> = {
	toLisp: (calls) => arrayToList(calls.map(([id, form]) => new Cell(id, form))),
	fromLisp: (list) =>
		listToArray(list as List).map((pair) => [
			(pair as Cell).car as string,
			(pair as Cell).cdr as Cell,
		]),
};

function isCallForm(x: unknown): x is Cell {
	return (
		x instanceof Cell && x.car instanceof Sym && !(x.car instanceof Keyword)
	);
}

const UI_TAG = "ui/element";

export class UiSurface {
	private handlers: State<[string, unknown][]> | undefined;
	private calls: State<[string, Cell][]> | undefined;
	private seq: State<number> | undefined;
	private views: State<number> | undefined;
	private owners: State<[string, string][]> | undefined;
	private current: string | undefined;
	private interp: Interp | undefined;
	private channels: Channels | undefined;
	private store: ViewStore | undefined;

	bind(interp: Interp, store?: ViewStore): void {
		this.interp = interp;
		this.store = store;
		this.channels = interp.channels;
		this.handlers = interp.state(
			"ui/handlers",
			handlerCodec,
			[],
			"The function behind each control on screen, by the action id the view carries. The oldest are dropped past 500.",
		);
		this.calls = interp.state(
			"ui/calls",
			callCodec,
			[],
			"The quoted call behind each control given one instead of a function, by action id. Kept whole, since the same call reuses its id.",
		);
		this.seq = interp.state(
			"ui/seq",
			seqCodec,
			0,
			"The number of the last action id handed out.",
		);
		this.views = interp.state(
			"ui/views",
			seqCodec,
			0,
			"The number of the last view id handed out.",
		);
		this.owners = interp.state(
			"ui/owners",
			ownerCodec,
			[],
			"The view id each action id was rendered in, so a click renders back into the view it came from. The oldest are dropped past 500.",
		);
	}

	beginStep(): void {
		this.current = undefined;
	}

	enter(action: string): void {
		this.current = this.ownerOf(action);
	}

	private viewId(): string {
		if (this.current !== undefined) return this.current;
		const n = (this.views?.get() ?? 0) + 1;
		this.views?.set(n);
		this.current = `v${n}`;
		return this.current;
	}

	place(viewId: string, node: UiNode): RenderedView {
		const owned = actionsOf(node).map(
			(action) => [action, viewId] as [string, string],
		);
		if (owned.length > 0) {
			const kept = (this.owners?.get() ?? []).filter(
				([at]) => !owned.some(([action]) => action === at),
			);
			this.owners?.set([...kept, ...owned].slice(-MAX_HANDLERS));
		}
		return { viewId, node: plainNode(node) };
	}

	reset(): void {
		this.handlers?.set([]);
	}

	private nextId(): string {
		const n = (this.seq?.get() ?? 0) + 1;
		this.seq?.set(n);
		return `a${n}`;
	}

	private callAction(form: Cell): string {
		const held = this.calls?.get() ?? [];
		const printed = str(form);
		const same = held.find(([, at]) => str(at) === printed);
		if (same !== undefined) return same[0];
		const id = this.nextId();
		this.calls?.set([...held, [id, form]]);
		return id;
	}

	action(fn: unknown): string {
		if (isCallForm(fn)) return this.callAction(fn);
		if (callableArity(fn) === undefined)
			throw new EvalException(
				"function or quoted call expected as a ui action",
				fn,
			);
		const id = this.nextId();
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
		const calls = this.calls?.get() ?? [];
		const keptCalls = calls.filter(([id]) => !ids.includes(id));
		this.calls?.set(keptCalls);
		return held.length - kept.length + calls.length - keptCalls.length;
	}

	private call(id: string): Cell | undefined {
		return this.calls?.get().find(([at]) => at === id)?.[1];
	}

	private ownerOf(id: string): string | undefined {
		return this.owners?.get().find(([at]) => at === id)?.[1];
	}

	*expireOwners(ids: readonly string[]): Eval<void> {
		const store = this.store;
		if (store === undefined) return;
		const owned = new Set(ids.flatMap((id) => this.ownerOf(id) ?? []));
		for (const viewId of owned) yield* settled(store.expire(viewId));
	}

	private handler(id: string): unknown {
		return this.handlers?.get().find(([at]) => at === id)?.[1];
	}

	render(node: UiNode): RenderedView {
		const view = this.place(this.viewId(), node);
		const channels = this.channels;
		if (channels) rendered.emit(channels, { user: view });
		return view;
	}

	send(text: string): void {
		const channels = this.channels;
		if (channels) sent.emit(channels, { model: text });
	}

	hasAction(id: string): boolean {
		return this.handler(id) !== undefined || this.call(id) !== undefined;
	}

	private resolved(form: Cell): { fn: unknown; args: unknown[] } {
		const name = form.car as Sym;
		const interp = this.interp;
		if (interp === undefined || !interp.hasGlobal(name))
			throw new EvalException(
				"ui action calls a function that is not defined",
				name,
				false,
			);
		const fn = interp.getGlobal(name);
		if (callableArity(fn) === undefined)
			throw new EvalException("ui action calls a non-function", name, false);
		return { fn, args: listToArray(form.cdr as List) };
	}

	async invoke(id: string, values: Record<string, unknown>): Promise<unknown> {
		const form = this.call(id);
		const { fn, args: given } =
			form === undefined
				? { fn: this.handler(id), args: [] as unknown[] }
				: this.resolved(form);
		if (fn === undefined) {
			const owner = this.ownerOf(id);
			if (owner === undefined || this.store === undefined)
				throw new EvalException("no such ui action", id, false);
			await this.store.expire(owner);
			return Unspecified;
		}
		const interp = this.interp;
		if (interp === undefined)
			throw new EvalException("ui surface is not bound to an interpreter", id);
		const arity = callableArity(fn);
		const takesValues =
			arity !== undefined && (arity.max ?? given.length + 1) > given.length;
		const args = arrayToList(
			(takesValues ? [...given, jsonToLisp(values)] : given).map(quoted),
		);
		const { value } = await driveAsync(
			interp.evalGen(new Cell(fn, args), null),
		);
		return value;
	}
}

function quoted(x: unknown): unknown {
	return new Cell(newSym("quote"), new Cell(x, null));
}

function plainNode(node: UiNode): UiNode {
	return {
		tag: node.tag,
		props: node.props,
		children: node.children.map(plainNode),
	};
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

function defineWidget<T extends Tag>(
	interp: Interp,
	surface: UiSurface,
	tag: T,
): void {
	const spec = WIDGET_FORMS[tag];
	const build = spec.build as (
		args: unknown[],
		action: (fn: unknown) => string,
	) => ReturnType<typeof spec.build>;
	interp.def(
		`ui/${tag}`,
		spec.arity,
		spec.signature,
		spec.doc,
		spec.args,
		(args) => {
			const { props, children } = build(args, (fn) => surface.action(fn));
			return element(tag, props, children);
		},
		spec.docArgs,
		spec.nameable ? spec.docArgs?.map((a) => a.name) : undefined,
	);
}

function registerUi(
	interp: Interp,
	surface: UiSurface,
	panel: PanelStore,
	views: ViewStore,
	tours: TourStore,
): void {
	surface.bind(interp, views);
	surface.reset();
	interp.recovery.kind({
		name: UI_TAG,
		claims: (x) => x instanceof UiElement,
		save: (x) => nodeToJson(x as UiElement),
		restore: (data) => elementOf(data as UiNode),
	});

	for (const tag of TAGS) defineWidget(interp, surface, tag);
	registerTours(interp, tours, {
		action: (form) => surface.action(form),
		send: (text) => surface.send(text),
	});

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
			const placed = surface.place(tab, view);
			yield* settled(views.put(placed));
			yield* emit({
				op: "open",
				tab,
				split: splitOf(plistOptions(rest, ["split"])),
				content: { kind: "view", title, viewId: placed.viewId },
			});
			return tab;
		},
	);

	interp.defGen(
		"ui/open",
		-2,
		'(ui/open page [:split "right"])',
		`Open a page of the app in a tab of the panel beside the chat. \`page\` is one of ${PAGE_IDS.join(" ")}. A page already open is focused instead. \`:split\` is as for \`ui/open-file\`. Returns the tab id.`,
		z.tuple([zAny, zList]),
		function* ([name, rest]): Eval {
			const page = pageOf(name);
			const tab = pageTab(page);
			yield* emit({
				op: "open",
				tab,
				split: splitOf(plistOptions(rest, ["split"])),
				content: { kind: "page", page, title: pages[page].title },
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

	function* renderView(view: UiElement): Eval<string> {
		yield* settled(views.put(surface.render(view)));
		const { elements, actions } = summarize(view);
		return `rendered ${view.tag}, ${elements} element${elements === 1 ? "" : "s"}, ${actions} action${actions === 1 ? "" : "s"}`;
	}

	interp.defGen(
		"ui/render",
		1,
		"(ui/render view)",
		"Put a widget on the user's screen, replacing whatever this step rendered before. Returns a one-line summary, because the view is for the USER to read — describing it back to yourself would spend the context the widget just saved.",
		z.tuple([zAny]),
		function* ([view]): Eval {
			if (!(view instanceof UiElement))
				throw new EvalException("ui element expected", view);
			return yield* renderView(view);
		},
	);

	interp.defGen(
		"ui/forget",
		1,
		"(ui/forget view)",
		"Drop the handlers behind every control in `view`, so clicking them runs nothing any more and the view it was rendered in shows as expired. Use it on a view you replaced or closed. Returns how many were dropped.",
		z.tuple([zAny]),
		function* ([view]): Eval {
			if (!(view instanceof UiElement))
				throw new EvalException("ui element expected", view);
			const ids = actionsOf(view);
			const dropped = surface.drop(ids);
			if (dropped > 0) yield* surface.expireOwners(ids);
			return BigInt(dropped);
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
	interp.defGen(
		"echo",
		-1,
		textEchoDoc.signature,
		`${textEchoDoc.doc} When any argument is a widget, the whole echo is rendered instead, as \`ui/render\` would: the widget alone, or a \`ui/stack\` of every argument in order with the rest as \`ui/text\`, and it returns the one-line summary \`ui/render\` returns.`,
		z.tuple([zList]),
		function* ([rest]): Eval {
			const args = listElements(rest) ?? [];
			if (!args.some((x) => x instanceof UiElement))
				return textEcho.call([rest]);
			const nodes = args.map((x) => (x instanceof UiElement ? x : textOf(x)));
			const [only] = nodes;
			return yield* renderView(
				nodes.length === 1 && only !== undefined
					? only
					: element("stack", {}, nodes),
			);
		},
		textEchoDoc.args,
	);
}

export interface UiHost {
	prompt: PromptSource;
	panel: PanelStore;
	views: ViewStore;
	tours: TourStore;
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
		(interp: Interp): void =>
			registerUi(interp, surface, host.panel, host.views, host.tours),
		{
			surface,
			prompt: host
				.prompt()
				.replace("{{widgets}}", widgetPromptSection())
				.replace("{{anchors}}", anchorPromptSection())
				.replace("{{pages}}", pagePromptSection()),
			session(hooks: SessionHooks): void {
				hooks.evalStep.use(async (ctx, next) => {
					surface.beginStep();
					await next(ctx);
				});
				hooks.invoke.use(async (ctx) => {
					surface.enter(ctx.action);
					await surface.invoke(ctx.action, ctx.values);
				});
				hooks.annotate.use((buffer, into, next) => {
					const view = buffer.collect(rendered).at(-1);
					return next(
						buffer,
						view === undefined
							? into
							: annotate(into, viewKey, { viewId: view.viewId }),
					);
				});
				hooks.message.use(
					(buffer, next) => joinMessages(buffer.collect(sent)) ?? next(buffer),
				);
			},
		},
	);
}
