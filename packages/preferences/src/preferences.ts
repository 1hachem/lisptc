import { type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	type List,
	newLispKeyword,
} from "@repo/interpreter/objects";
import { parsePlist, plistOptions } from "@repo/interpreter/plist";
import { zList } from "@repo/interpreter/schema";
import type { InterpExtension } from "@repo/interpreter/session";
import { z } from "zod";
import type { Choice, Preferences, PreferencesHost, Toggles } from "./ports.ts";

const SET_KEYS = ["theme", "font", "channels", "metadata"];

const SET_ARGS = [
	{
		name: "theme",
		type: "string",
		required: false,
		description: "a theme id from (themes)",
	},
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
		["theme", preferences.theme ?? null],
		["font", preferences.font ?? null],
		["channels", togglesList(preferences.channels)],
		["metadata", togglesList(preferences.metadata)],
	]);
}

function choices(offered: readonly Choice[]): List {
	return arrayToList(offered.map((choice) => new Cell(choice.id, choice.name)));
}

function chosen(
	kind: "theme" | "font",
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
	kind: "channels" | "metadata",
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

export function registerPreferences(
	interp: Interp,
	host: PreferencesHost,
): void {
	const { store } = host;

	interp.defGen(
		"preferences",
		0,
		"(preferences)",
		"Return the user's preferences as a plist: (:theme id :font id :channels (:id t ...) :metadata (:id t ...)). They belong to the user, not the workspace, and the app applies them live.",
		z.tuple([]),
		function* (): Eval {
			return preferencesList(yield* settled(store.read()));
		},
	);

	interp.defGen(
		"preferences/set",
		-1,
		"(preferences/set [:theme id] [:font id] [:channels (:id t ...)] [:metadata (:id t ...)])",
		"Change the user's preferences. Only the keys given change; a toggle not named keeps its value. The app re-renders at once. Returns the preferences after the change.",
		z.tuple([zList]),
		function* ([rest]): Eval {
			const options = plistOptions(rest, SET_KEYS);
			if (options.size === 0)
				throw new EvalException(
					"nothing to set, give one of :theme :font :channels :metadata",
					null,
				);
			const current = yield* settled(store.read());
			const change: Preferences = {};
			if (options.has("theme"))
				change.theme = chosen("theme", options.get("theme"), host.themes);
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
			yield* settled(store.write(change));
			return preferencesList({ ...current, ...change });
		},
		SET_ARGS,
	);

	interp.def(
		"themes",
		0,
		"(themes)",
		"Return an alist of (id . name) for every theme the app offers.",
		z.tuple([]),
		() => choices(host.themes),
	);

	interp.def(
		"fonts",
		0,
		"(fonts)",
		"Return an alist of (id . name) for every font the app offers.",
		z.tuple([]),
		() => choices(host.fonts),
	);
}

export function preferencesExtension(host: PreferencesHost): InterpExtension {
	return Object.assign(
		(interp: Interp): void => registerPreferences(interp, host),
		{ prompt: host.prompt() },
	);
}
