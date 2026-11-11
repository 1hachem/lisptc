import { type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	type List,
	listToArray,
	newLispKeyword,
} from "@repo/interpreter/objects";
import { parsePlist, plistOptions } from "@repo/interpreter/plist";
import { zList } from "@repo/interpreter/schema";
import type { InterpExtension } from "@repo/interpreter/session";
import type { DesktopPreferences } from "@repo/shared/desktop";
import {
	STATUS_BAR_GAP_PREFIX,
	STATUS_BAR_GAPS,
	STATUS_BAR_ITEMS,
	STATUS_BAR_SLOT_COUNT,
	STATUS_BAR_SLOTS,
} from "@repo/shared/status-bar";
import { z } from "zod";
import type { Choice, Preferences, PreferencesHost, Toggles } from "./ports.ts";

const SET_KEYS = [
	"font",
	"metadata",
	"input",
	"sidebar",
	"sidebar-right",
	"hidden",
	"status-bar",
	"status-bar-hidden",
	"motion",
	"panel-motion",
	"trace-beside-chat",
	"trace-link",
];

const SET_ARGS = [
	{
		name: "font",
		type: "string",
		required: false,
		description: "a font id from (fonts)",
	},
	{
		name: "metadata",
		type: "plist",
		required: false,
		description:
			"which metadata fields the chat shows, as (:id t-or-nil ...); ids not named keep their value",
	},
	{
		name: "input",
		type: "plist",
		required: false,
		description:
			"which helpers the chat input runs as the user types, as (:id t-or-nil ...); ids not named keep their value",
	},
	{
		name: "sidebar",
		type: "list",
		required: false,
		description:
			'the left sidebar\'s entries, top first, as ("name" ...); a named entry on the right moves left, and entries not named follow in their current order',
	},
	{
		name: "sidebar-right",
		type: "list",
		required: false,
		description:
			'the right sidebar\'s entries, top first, as ("name" ...); a named entry on the left moves right, and entries not named follow in their current order',
	},
	{
		name: "hidden",
		type: "list",
		required: false,
		description:
			'every sidebar entry to hide, as ("name" ...); an entry not named is shown, so \'() shows them all',
	},
	{
		name: "status-bar",
		type: "list",
		required: false,
		description: `the bottom bar's ${STATUS_BAR_SLOT_COUNT} slots, first to last, left to right, as ("name" ...); each empty slot is a gap named like an item, "${STATUS_BAR_GAP_PREFIX}1" through "${STATUS_BAR_GAPS.at(-1)}"; slots not named follow in their current order`,
	},
	{
		name: "status-bar-hidden",
		type: "list",
		required: false,
		description:
			'every bottom bar item to hide, as ("name" ...); an item not named is shown, so \'() shows them all',
	},
	{
		name: "motion",
		type: "string",
		required: false,
		description:
			"how the sidebar animates a drag, a motion id from (motions); the system's reduced-motion setting still wins",
	},
	{
		name: "panel-motion",
		type: "boolean",
		required: false,
		description:
			"t to animate panels as they open, split and switch tabs, nil to keep them still; the system's reduced-motion setting still wins",
	},
	{
		name: "trace-beside-chat",
		type: "boolean",
		required: false,
		description:
			"t to open a chat's trace in a tab to its right whenever the chat opens, nil to open the trace only when asked",
	},
	{
		name: "trace-link",
		type: "boolean",
		required: false,
		description:
			"t to show a control on a message's metadata that opens the trace at that message, nil to hide it",
	},
];

function plist(entries: [string, unknown][]): List {
	return arrayToList(
		entries.flatMap(([key, value]) => [newLispKeyword(key), value]),
	);
}

function togglesList(toggles: Toggles | undefined): List {
	return plist(
		Object.entries(toggles ?? {}).map(([id, on]) => [id, on ? true : null]),
	);
}

export function preferencesList(preferences: Preferences): List {
	return plist([
		["font", preferences.font ?? null],
		["metadata", togglesList(preferences.metadata)],
		["input", togglesList(preferences.input)],
		["sidebar", arrayToList([...(preferences.sidebar ?? [])])],
		["sidebar-right", arrayToList([...(preferences.sidebarRight ?? [])])],
		["hidden", arrayToList([...(preferences.hidden ?? [])])],
		["status-bar", arrayToList([...(preferences.statusBar ?? [])])],
		[
			"status-bar-hidden",
			arrayToList([...(preferences.statusBarHidden ?? [])]),
		],
		["motion", preferences.motion ?? null],
		["panel-motion", preferences.panelMotion === false ? null : true],
		["trace-beside-chat", preferences.traceBesideChat === true ? true : null],
		["trace-link", preferences.traceLink === false ? null : true],
	]);
}

function choices(offered: readonly Choice[]): List {
	return arrayToList(offered.map((choice) => new Cell(choice.id, choice.name)));
}

function chosen(
	kind: "font" | "motion",
	value: unknown,
	offered: readonly Choice[],
): string {
	if (typeof value !== "string")
		throw new EvalException(`a ${kind} id must be a string`, value);
	if (offered.length > 0 && !offered.some((choice) => choice.id === value))
		throw new EvalException(`unknown ${kind}, see (${kind}s)`, value);
	return value;
}

function toggled(
	kind: "metadata" | "input",
	value: unknown,
	known: Toggles | undefined,
): Toggles {
	if (value !== null && !(value instanceof Cell))
		throw new EvalException(`${kind} must be a plist (:id t ...)`, value);
	const ids = Object.keys(known ?? {});
	const change = ids.length > 0 ? plistOptions(value, ids) : parsePlist(value);
	const next: Record<string, boolean> = { ...known };
	for (const [id, on] of change) {
		if (on !== true && on !== null)
			throw new EvalException(`${kind} toggles take t or nil`, on);
		next[id] = on === true;
	}
	return next;
}

type Listed = "sidebar entry" | "status bar item";

function names(
	kind: string,
	what: Listed,
	value: unknown,
	known: readonly string[] | undefined,
): string[] {
	if (value !== null && !(value instanceof Cell))
		throw new EvalException(`${kind} must be a list ("name" ...)`, value);
	const named = listToArray(value).map((name) => {
		if (typeof name !== "string")
			throw new EvalException(`a ${what} is named by a string`, name);
		if (known && known.length > 0 && !known.includes(name))
			throw new EvalException(
				`unknown ${what}, there are ${known.map((id) => JSON.stringify(id)).join(" ")}`,
				name,
			);
		return name;
	});
	if (new Set(named).size !== named.length)
		throw new EvalException(`a ${what} is named twice`, value);
	return named;
}

function ordered(
	kind: string,
	what: Listed,
	value: unknown,
	known: readonly string[] | undefined,
): string[] {
	const named = names(kind, what, value, known);
	return [...named, ...(known ?? []).filter((name) => !named.includes(name))];
}

function sidebarSides(
	toLeft: unknown,
	toRight: unknown,
	left: readonly string[],
	right: readonly string[],
): { left: string[]; right: string[] } {
	const known = [...left, ...right];
	const namedLeft = names("sidebar", "sidebar entry", toLeft, known);
	const namedRight = names("sidebar-right", "sidebar entry", toRight, known);
	const both = namedLeft.find((name) => namedRight.includes(name));
	if (both !== undefined)
		throw new EvalException(
			"a sidebar entry goes in :sidebar or :sidebar-right, not both",
			both,
		);
	const placed = new Set([...namedLeft, ...namedRight]);
	return {
		left: [...namedLeft, ...left.filter((name) => !placed.has(name))],
		right: [...namedRight, ...right.filter((name) => !placed.has(name))],
	};
}

function statusBarSlots(stored: readonly string[] | undefined): string[] {
	const kept = (stored ?? []).filter((name) => STATUS_BAR_SLOTS.includes(name));
	return [
		...new Set(kept),
		...STATUS_BAR_SLOTS.filter((name) => !kept.includes(name)),
	];
}

const DESKTOP_KEYS = ["close-to-tray", "open-at-login"] as const;

function desktopList(preferences: DesktopPreferences): List {
	return arrayToList([
		newLispKeyword("close-to-tray"),
		preferences.closeToTray ? true : null,
		newLispKeyword("open-at-login"),
		preferences.openAtLogin ? true : null,
	]);
}

export function registerPreferences(
	interp: Interp,
	host: PreferencesHost,
): void {
	const { store } = host;

	interp.defGen(
		"preferences",
		0,
		"(preferences)",
		'Return this workspace\'s preferences as a plist: (:font id :metadata (:id t ...) :input (:id t ...) :sidebar ("name" ...) :sidebar-right ("name" ...) :hidden ("name" ...) :status-bar ("name" ...) :status-bar-hidden ("name" ...) :motion id :panel-motion t :trace-beside-chat nil :trace-link t). Each workspace keeps its own, as it keeps its theme, and the app applies them live. The theme itself is read with (settings).',
		z.tuple([]),
		function* (): Eval {
			return preferencesList(yield* settled(store.read()));
		},
	);

	interp.defGen(
		"preferences/set",
		-1,
		'(preferences/set [:font id] [:metadata (:id t ...)] [:input (:id t ...)] [:sidebar ("name" ...)] [:sidebar-right ("name" ...)] [:hidden ("name" ...)] [:status-bar ("name" ...)] [:status-bar-hidden ("name" ...)] [:motion id] [:panel-motion t] [:trace-beside-chat t] [:trace-link t])',
		"Change this workspace's preferences. Only the keys given change, and other workspaces keep theirs; a toggle not named keeps its value. The app re-renders at once. Returns the preferences after the change.",
		z.tuple([zList]),
		function* ([rest]): Eval {
			const options = plistOptions(rest, SET_KEYS);
			if (options.size === 0)
				throw new EvalException(
					"nothing to set, give one of :font :metadata :input :sidebar :sidebar-right :hidden :status-bar :status-bar-hidden :motion :panel-motion :trace-beside-chat :trace-link",
					null,
				);
			const current = yield* settled(store.read());
			const change: Preferences = {};
			if (options.has("font"))
				change.font = chosen("font", options.get("font"), host.fonts);
			if (options.has("metadata"))
				change.metadata = toggled(
					"metadata",
					options.get("metadata"),
					current.metadata,
				);
			if (options.has("input"))
				change.input = toggled("input", options.get("input"), current.input);
			const left = current.sidebar ?? [];
			const right = current.sidebarRight ?? [];
			if (options.has("sidebar") || options.has("sidebar-right")) {
				const sides = sidebarSides(
					options.has("sidebar") ? options.get("sidebar") : null,
					options.has("sidebar-right") ? options.get("sidebar-right") : null,
					left,
					right,
				);
				change.sidebar = sides.left;
				change.sidebarRight = sides.right;
			}
			if (options.has("hidden"))
				change.hidden = names(
					"hidden",
					"sidebar entry",
					options.get("hidden"),
					[...left, ...right],
				);
			if (options.has("status-bar"))
				change.statusBar = ordered(
					"status-bar",
					"status bar item",
					options.get("status-bar"),
					statusBarSlots(current.statusBar),
				);
			if (options.has("status-bar-hidden"))
				change.statusBarHidden = names(
					"status-bar-hidden",
					"status bar item",
					options.get("status-bar-hidden"),
					statusBarSlots(current.statusBar),
				);
			if (options.has("motion"))
				change.motion = chosen("motion", options.get("motion"), host.motions);
			if (options.has("panel-motion"))
				change.panelMotion = options.get("panel-motion") !== null;
			if (options.has("trace-beside-chat"))
				change.traceBesideChat = options.get("trace-beside-chat") !== null;
			if (options.has("trace-link"))
				change.traceLink = options.get("trace-link") !== null;
			yield* settled(store.write(change));
			return preferencesList({ ...current, ...change });
		},
		SET_ARGS,
	);

	function* desktopApplied(
		change: Partial<DesktopPreferences>,
	): Eval<DesktopPreferences> {
		const applied =
			host.desktop === undefined
				? undefined
				: yield* settled(host.desktop.apply(change));
		if (applied === undefined)
			throw new EvalException(
				"no desktop app connected, desktop preferences need lisptc desktop open and signed in",
				null,
			);
		return applied;
	}

	interp.defGen(
		"desktop-preferences",
		0,
		"(desktop-preferences)",
		"Return the desktop app's preferences as a plist: (:close-to-tray t :open-at-login nil). They live on the user's machine, so this errors when no desktop app is connected.",
		z.tuple([]),
		function* (): Eval {
			return desktopList(yield* desktopApplied({}));
		},
	);

	interp.defGen(
		"desktop-preferences/set",
		-1,
		"(desktop-preferences/set [:close-to-tray t] [:open-at-login t])",
		"Change the desktop app's preferences. Only the keys given change. Errors when no desktop app is connected. Returns the preferences after the change.",
		z.tuple([zList]),
		function* ([rest]): Eval {
			const options = plistOptions(rest, DESKTOP_KEYS);
			if (options.size === 0)
				throw new EvalException(
					"nothing to set, give one of :close-to-tray :open-at-login",
					null,
				);
			const change: Partial<DesktopPreferences> = {};
			if (options.has("close-to-tray"))
				change.closeToTray = options.get("close-to-tray") !== null;
			if (options.has("open-at-login"))
				change.openAtLogin = options.get("open-at-login") !== null;
			return desktopList(yield* desktopApplied(change));
		},
	);

	interp.def(
		"fonts",
		0,
		"(fonts)",
		"Return an alist of (id . name) for every font the app offers.",
		z.tuple([]),
		() => choices(host.fonts),
	);

	interp.def(
		"motions",
		0,
		"(motions)",
		"Return an alist of (id . description) for every way the sidebar can animate a drag.",
		z.tuple([]),
		() => choices(host.motions),
	);
}

function escaped(text: string): string {
	return text.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function quoted(text: string): string {
	return escaped(JSON.stringify(text));
}

function keywords(keys: readonly string[]): string {
	return keys.map((key) => `:${key}`).join(" ");
}

function described(kind: string, offered: readonly Choice[]): string {
	if (offered.length === 0)
		throw new Error(`the host offers no ${kind} to describe`);
	return offered
		.map((choice) => `:${choice.id} ${escaped(choice.name)}`)
		.join(", ");
}

function firstOf(kind: string, offered: readonly Choice[]): string {
	const first = offered[0];
	if (first === undefined)
		throw new Error(`the host offers no ${kind} to describe`);
	return first.id;
}

export function filledMemories(host: PreferencesHost): string {
	const fills: Record<string, string> = {
		keys: keywords(SET_KEYS),
		"font-example": escaped(firstOf("fonts", host.fonts)),
		"desktop-keys": keywords(DESKTOP_KEYS),
		metadata: described("metadata", host.metadata),
		"metadata-example": firstOf("metadata", host.metadata),
		input: described("input helpers", host.input),
		"input-example": firstOf("input helpers", host.input),
		"status-bar-slots": String(STATUS_BAR_SLOT_COUNT),
		"status-bar-items": STATUS_BAR_ITEMS.map(quoted).join(" "),
		"status-bar-gaps": `${quoted(STATUS_BAR_GAPS[0] ?? "")} through ${quoted(STATUS_BAR_GAPS.at(-1) ?? "")}`,
		"status-bar-example": [
			STATUS_BAR_ITEMS[1],
			STATUS_BAR_GAPS[0],
			STATUS_BAR_ITEMS[0],
		]
			.map((name) => quoted(name ?? ""))
			.join(" "),
		"status-bar-hidden-example": quoted(STATUS_BAR_ITEMS.at(-1) ?? ""),
	};
	return host.memories().replace(/\{\{([a-z-]+)\}\}/g, (_, name: string) => {
		const fill = fills[name];
		if (fill === undefined)
			throw new Error(`no value fills {{${name}}} in the preferences memories`);
		return fill;
	});
}

export function preferencesExtension(host: PreferencesHost): InterpExtension {
	return Object.assign(
		(interp: Interp): void => registerPreferences(interp, host),
		{ prompt: host.prompt(), memories: filledMemories(host) },
	);
}
