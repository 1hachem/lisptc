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
import type { ChatEntry, Settings, WorkspaceHost } from "./ports.ts";

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
	]);
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

	interp.defGen(
		"settings",
		0,
		"(settings)",
		'Return the workspace\'s settings as a plist: (:name "…" :model "provider/model").',
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

	interp.defGen(
		SETTINGS_SET,
		-1,
		'(settings/set [:name "…"] [:model "provider/model"])',
		"Rename the workspace or change the model it runs on. The user approves it first. A new model answers from the next turn. Returns the settings after the change.",
		z.tuple([zList]),
		function* ([rest]): Eval {
			const options = plistOptions(rest, ["name", "model"]);
			if (options.size === 0)
				throw new EvalException("nothing to set, give :name or :model", null);
			if (options.has("model")) {
				const model = text("model", options.get("model"));
				if (!host.models.includes(model))
					throw new EvalException(
						"model not offered, see (settings/models)",
						model,
					);
				yield* settled(store.choose(model));
			}
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
		],
	);

	interp.defGen(
		"chats",
		-1,
		'(chats [:search "…"] [:limit n])',
		"Return the workspace's chats, most recently active first, as a list of (:id id :title title). With :search, the chats whose title matches.",
		z.tuple([zList]),
		function* ([rest]): Eval {
			const options = plistOptions(rest, ["search", "limit"]);
			const search = options.get("search");
			if (search !== undefined && typeof search !== "string")
				throw new EvalException("search must be a string", search);
			const page = yield* settled(
				store.chats({
					search,
					limit: count("limit", options.get("limit"), DEFAULT_CHATS),
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
