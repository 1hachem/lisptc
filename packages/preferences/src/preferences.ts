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
import { z } from "zod";
import type { Choice, Preferences, PreferencesHost, Toggles } from "./ports.ts";

const SET_KEYS = [
	"font",
	"channels",
	"metadata",
	"input",
	"send-label",
	"sidebar",
	"hidden",
	"status-bar",
	"status-bar-hidden",
	"motion",
	"panel-motion",
];

const MAX_SEND_LABEL = 16;

const SET_ARGS = [
	{
		name: "font",
		type: "string",
		required: false,
		description: "a font id from (fonts)",
	},
	{
		name: "channels",
		type: "plist",
		required: false,
		description:
			"which channels of a step the chat shows, as (:id t-or-nil ...); ids not named keep their value",
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
			"what the chat input shows and how it behaves, as (:id t-or-nil ...); ids not named keep their value",
	},
	{
		name: "send-label",
		type: "string",
		required: false,
		description: `the word on the chat input's send button, at most ${MAX_SEND_LABEL} characters`,
	},
	{
		name: "sidebar",
		type: "list",
		required: false,
		description:
			'the order of the sidebar\'s top-level entries, as ("name" ...); entries not named follow in their current order',
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
		description:
			'the order of the bottom bar\'s items, left to right, as ("name" ...); the first three fill the left, centre and right; items not named follow in their current order',
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
		["channels", togglesList(preferences.channels)],
		["metadata", togglesList(preferences.metadata)],
		["input", togglesList(preferences.input)],
		["send-label", preferences.sendLabel ?? null],
		["sidebar", arrayToList([...(preferences.sidebar ?? [])])],
		["hidden", arrayToList([...(preferences.hidden ?? [])])],
		["status-bar", arrayToList([...(preferences.statusBar ?? [])])],
		[
			"status-bar-hidden",
			arrayToList([...(preferences.statusBarHidden ?? [])]),
		],
		["motion", preferences.motion ?? null],
		["panel-motion", preferences.panelMotion === false ? null : true],
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
	kind: "channels" | "metadata" | "input",
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

function labelled(value: unknown): string {
	if (typeof value !== "string")
		throw new EvalException("a send label must be a string", value);
	const label = value.trim();
	if (label === "" || label.length > MAX_SEND_LABEL)
		throw new EvalException(
			`a send label takes 1 to ${MAX_SEND_LABEL} characters`,
			value,
		);
	return label;
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

export function registerPreferences(
	interp: Interp,
	host: PreferencesHost,
): void {
	const { store } = host;

	interp.defGen(
		"preferences",
		0,
		"(preferences)",
		'Return the user\'s preferences as a plist: (:font id :channels (:id t ...) :metadata (:id t ...) :input (:id t ...) :send-label "send" :sidebar ("name" ...) :hidden ("name" ...) :status-bar ("name" ...) :status-bar-hidden ("name" ...) :motion id :panel-motion t). They belong to the user, not the workspace, and the app applies them live. The theme is a workspace setting, see (settings).',
		z.tuple([]),
		function* (): Eval {
			return preferencesList(yield* settled(store.read()));
		},
	);

	interp.defGen(
		"preferences/set",
		-1,
		'(preferences/set [:font id] [:channels (:id t ...)] [:metadata (:id t ...)] [:input (:id t ...)] [:send-label "word"] [:sidebar ("name" ...)] [:hidden ("name" ...)] [:status-bar ("name" ...)] [:status-bar-hidden ("name" ...)] [:motion id] [:panel-motion t])',
		"Change the user's preferences. Only the keys given change; a toggle not named keeps its value. The app re-renders at once. Returns the preferences after the change.",
		z.tuple([zList]),
		function* ([rest]): Eval {
			const options = plistOptions(rest, SET_KEYS);
			if (options.size === 0)
				throw new EvalException(
					"nothing to set, give one of :font :channels :metadata :input :send-label :sidebar :hidden :status-bar :status-bar-hidden :motion :panel-motion",
					null,
				);
			const current = yield* settled(store.read());
			const change: Preferences = {};
			if (options.has("font"))
				change.font = chosen("font", options.get("font"), host.fonts);
			if (options.has("channels"))
				change.channels = toggled(
					"channels",
					options.get("channels"),
					current.channels,
				);
			if (options.has("metadata"))
				change.metadata = toggled(
					"metadata",
					options.get("metadata"),
					current.metadata,
				);
			if (options.has("input"))
				change.input = toggled("input", options.get("input"), current.input);
			if (options.has("send-label"))
				change.sendLabel = labelled(options.get("send-label"));
			if (options.has("sidebar"))
				change.sidebar = ordered(
					"sidebar",
					"sidebar entry",
					options.get("sidebar"),
					current.sidebar,
				);
			if (options.has("hidden"))
				change.hidden = names(
					"hidden",
					"sidebar entry",
					options.get("hidden"),
					current.sidebar,
				);
			if (options.has("status-bar"))
				change.statusBar = ordered(
					"status-bar",
					"status bar item",
					options.get("status-bar"),
					current.statusBar,
				);
			if (options.has("status-bar-hidden"))
				change.statusBarHidden = names(
					"status-bar-hidden",
					"status bar item",
					options.get("status-bar-hidden"),
					current.statusBar,
				);
			if (options.has("motion"))
				change.motion = chosen("motion", options.get("motion"), host.motions);
			if (options.has("panel-motion"))
				change.panelMotion = options.get("panel-motion") !== null;
			yield* settled(store.write(change));
			return preferencesList({ ...current, ...change });
		},
		SET_ARGS,
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

export function preferencesExtension(host: PreferencesHost): InterpExtension {
	return Object.assign(
		(interp: Interp): void => registerPreferences(interp, host),
		{ prompt: host.prompt() },
	);
}
