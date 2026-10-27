import { isNumeric } from "@repo/interpreter/arith";
import { type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	type List,
	newLispKeyword,
} from "@repo/interpreter/objects";
import { plistOptions, splitKeywordArgs } from "@repo/interpreter/plist";
import { zList } from "@repo/interpreter/schema";
import type { InterpExtension } from "@repo/interpreter/session";
import { z } from "zod";
import type {
	ChatEntry,
	Settings,
	ThemeChoice,
	WorkspaceHost,
} from "./ports.ts";

const SETTINGS_SET = "settings/set";
const CHAT_ARCHIVE = "chat/archive";
const CHAT_READ = "chat/read";

const DEFAULT_CHATS = 20;
const DEFAULT_LINES = 20;

const zString = z.custom<string>(
	(x) => typeof x === "string",
	"string expected",
);

export interface WorkspaceExtension extends InterpExtension {
	readonly asks: readonly string[];
}

function plist(entries: [string, unknown][]): List {
	return arrayToList(
		entries.flatMap(([key, value]) => [newLispKeyword(key), value]),
	);
}

export function settingsList(settings: Settings): List {
	return plist([
		["name", settings.name],
		["model", settings.model],
		["icon", settings.icon],
		["theme", settings.theme],
	]);
}

function darkCounterpart(
	current: string,
	offered: readonly ThemeChoice[],
	fallback: string | undefined,
): string {
	const family = offered.find((theme) => theme.id === current)?.family;
	const dark = offered.find(
		(theme) => theme.family === family && theme.scheme === "dark",
	);
	const id = dark?.id ?? fallback;
	if (id === undefined)
		throw new EvalException(
			"no dark theme to switch to, see (settings/themes)",
			current,
		);
	return id;
}

function chatList(chat: ChatEntry): List {
	return plist([
		["id", chat.id],
		["title", chat.title],
	]);
}

function text(kind: string, value: unknown): string {
	if (typeof value !== "string" || value.trim() === "")
		throw new EvalException(`${kind} must be a non-empty string`, value);
	return value.trim();
}

function count(kind: string, value: unknown, fallback: number): number {
	if (value === undefined) return fallback;
	if (!isNumeric(value) || Number(value) < 1)
		throw new EvalException(`${kind} must be a positive number`, value);
	return Math.floor(Number(value));
}

export function registerWorkspace(interp: Interp, host: WorkspaceHost): void {
	const { store } = host;

	function* chosenTheme(value: unknown): Eval<string> {
		const id = text("theme", value);
		if (id === "dark")
			return darkCounterpart(
				(yield* settled(store.settings())).theme,
				host.themes,
				host.defaultDarkTheme,
			);
		if (!host.themes.some((theme) => theme.id === id))
			throw new EvalException("theme not offered, see (settings/themes)", id);
		return id;
	}

	interp.defGen(
		"settings",
		0,
		"(settings)",
		'Return the workspace\'s settings as a plist: (:name "…" :model "provider/model" :icon "…" :theme id).',
		z.tuple([]),
		function* (): Eval {
			return settingsList(yield* settled(store.settings()));
		},
	);

	interp.def(
		"settings/models",
		0,
		"(settings/models)",
		"Return the models a workspace can run on, as provider/model strings.",
		z.tuple([]),
		() => arrayToList([...host.models]),
	);

	interp.def(
		"settings/icons",
		0,
		"(settings/icons)",
		"Return the icons a workspace can show in the sidebar.",
		z.tuple([]),
		() => arrayToList([...host.icons]),
	);

	interp.def(
		"settings/themes",
		0,
		"(settings/themes)",
		"Return an alist of (id . name) for every theme a workspace can wear.",
		z.tuple([]),
		() =>
			arrayToList(host.themes.map((theme) => new Cell(theme.id, theme.name))),
	);

	interp.defGen(
		SETTINGS_SET,
		-1,
		'(settings/set [:name "…"] [:model "provider/model"] [:icon "…"] [:theme id])',
		"Rename the workspace, change the model it runs on, the icon it shows or the theme the app wears in it. The user approves it first. A new model answers from the next turn. Returns the settings after the change.",
		z.tuple([zList]),
		function* ([rest]): Eval {
			const options = plistOptions(rest, ["name", "model", "icon", "theme"]);
			if (options.size === 0)
				throw new EvalException(
					"nothing to set, give :name, :model, :icon or :theme",
					null,
				);
			const icon = options.has("icon")
				? text("icon", options.get("icon"))
				: undefined;
			if (icon !== undefined && !host.icons.includes(icon))
				throw new EvalException("icon not offered, see (settings/icons)", icon);
			if (options.has("model")) {
				const model = text("model", options.get("model"));
				if (!host.models.includes(model))
					throw new EvalException(
						"model not offered, see (settings/models)",
						model,
					);
				yield* settled(store.choose(model));
			}
			const theme = options.has("theme")
				? yield* chosenTheme(options.get("theme"))
				: undefined;
			if (icon !== undefined) yield* settled(store.pickIcon(icon));
			if (theme !== undefined) yield* settled(store.pickTheme(theme));
			if (options.has("name"))
				yield* settled(store.rename(text("name", options.get("name"))));
			return settingsList(yield* settled(store.settings()));
		},
		[
			{ name: "name", type: "string", required: false },
			{
				name: "model",
				type: "string",
				required: false,
				description: "one of (settings/models)",
			},
			{
				name: "icon",
				type: "string",
				required: false,
				description: "one of (settings/icons)",
			},
			{
				name: "theme",
				type: "string",
				required: false,
				description:
					'a theme id from (settings/themes), or "dark" for the dark counterpart of the current theme, falling back to the default dark theme',
			},
		],
	);

	interp.defGen(
		"chats",
		-1,
		'(chats [:search "…"] [:limit n] [:archived t])',
		"Return the workspace's chats, most recently active first, as a list of (:id id :title title). With :search, the chats whose title matches. With :archived t, the archived chats instead, most recently archived first.",
		z.tuple([zList]),
		function* ([rest]): Eval {
			const options = plistOptions(rest, ["search", "limit", "archived"]);
			const search = options.get("search");
			if (search !== undefined && typeof search !== "string")
				throw new EvalException("search must be a string", search);
			const archived = options.get("archived");
			const page = yield* settled(
				store.chats({
					search,
					limit: count("limit", options.get("limit"), DEFAULT_CHATS),
					archived: archived !== undefined && archived !== null,
				}),
			);
			return arrayToList(page.chats.map(chatList));
		},
	);

	interp.defGen(
		"chat/title",
		1,
		'(chat/title "…")',
		"Give the chat you are in a title, as it shows in the sidebar. Returns the title.",
		z.tuple([zString]),
		function* ([title]): Eval {
			if (host.chatId === undefined)
				throw new EvalException("this session is in no chat", null);
			const named = text("title", title);
			yield* settled(store.retitle(host.chatId, named));
			return named;
		},
	);

	interp.defGen(
		"chat/rename",
		2,
		'(chat/rename id "…")',
		"Give another chat of the workspace a new title. Returns the title.",
		z.tuple([zString, zString]),
		function* ([id, title]): Eval {
			const named = text("title", title);
			yield* settled(store.retitle(id, named));
			return named;
		},
	);

	interp.defGen(
		CHAT_ARCHIVE,
		1,
		"(chat/archive id)",
		"Archive a chat, taking it out of the sidebar. The user approves it first.",
		z.tuple([zString]),
		function* ([id]): Eval {
			if (id === host.chatId)
				throw new EvalException("cannot archive the chat you are in", id);
			yield* settled(store.archive(id));
			return true;
		},
	);

	interp.defGen(
		"chat/unarchive",
		1,
		"(chat/unarchive id)",
		"Bring an archived chat back to the sidebar. Its id comes from (chats :archived t).",
		z.tuple([zString]),
		function* ([id]): Eval {
			yield* settled(store.unarchive(id));
			return true;
		},
	);

	interp.defGen(
		CHAT_READ,
		-1,
		"(chat/read id [:last n])",
		"Return the last messages of another chat as a list of (role . text). The user approves it first.",
		z.tuple([zList]),
		function* ([rest]): Eval {
			const { values, options } = splitKeywordArgs(rest, ["last"]);
			const id = values instanceof Cell ? values.car : undefined;
			if (typeof id !== "string")
				throw new EvalException("a chat id must be a string", id ?? null);
			const last = count(
				"last",
				plistOptions(options, ["last"]).get("last"),
				DEFAULT_LINES,
			);
			const lines = yield* settled(store.transcript(id));
			return arrayToList(
				lines.slice(-last).map((line) => new Cell(line.role, line.text)),
			);
		},
	);
}

export function workspaceExtension(host: WorkspaceHost): WorkspaceExtension {
	return Object.assign(
		(interp: Interp): void => registerWorkspace(interp, host),
		{
			asks: [SETTINGS_SET, CHAT_ARCHIVE, CHAT_READ],
			prompt: host.prompt(),
		},
	);
}
