import { isNumeric } from "@repo/interpreter/arith";
import { type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	EndOfFile,
	jsonToLisp,
	type List,
	lispToJson,
	newLispKeyword,
} from "@repo/interpreter/objects";
import { plistOptions, splitKeywordArgs } from "@repo/interpreter/plist";
import { str } from "@repo/interpreter/print";
import { Reader } from "@repo/interpreter/reader";
import { zAny, zList } from "@repo/interpreter/schema";
import type { InterpExtension } from "@repo/interpreter/session";
import { z } from "zod";
import type { ChatEntry, Settings, WorkspaceHost } from "./ports.ts";

const SETTINGS_SET = "settings/set";
const CHAT_ARCHIVE = "chat/archive";
const CHAT_READ = "chat/read";
const FILE_WRITE = "file/write";
const FILE_DELETE = "file/delete";

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

const CONTENT_TYPES: Record<string, string> = {
	csv: "text/csv",
	htm: "text/html",
	html: "text/html",
	json: "application/json",
	md: "text/markdown",
	ptc: "text/plain",
	txt: "text/plain",
	xml: "application/xml",
	yaml: "application/yaml",
	yml: "application/yaml",
};

const utf8 = new TextDecoder("utf-8", { fatal: true });

function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function contentTypeOf(name: string): string {
	return CONTENT_TYPES[extensionOf(name)] ?? "text/plain";
}

function textOf(name: string, bytes: Uint8Array): string {
	let decoded: string | undefined;
	try {
		decoded = utf8.decode(bytes);
	} catch {
		decoded = undefined;
	}
	if (decoded === undefined || decoded.includes("\0"))
		throw new EvalException(
			`${name} is binary and cannot be read as text`,
			name,
		);
	return decoded;
}

function parseJson(name: string, text: string): unknown {
	try {
		return jsonToLisp(JSON.parse(text));
	} catch (ex) {
		throw new EvalException(
			`${name} is not JSON: ${ex instanceof Error ? ex.message : String(ex)}`,
			name,
		);
	}
}

export function readFile(name: string, bytes: Uint8Array): unknown {
	const text = textOf(name, bytes);
	switch (extensionOf(name)) {
		case "ptc":
			return parseFile(name, text);
		case "json":
			return parseJson(name, text);
		default:
			return text;
	}
}

function encodeJson(name: string, value: unknown): string {
	if (typeof value === "string") {
		parseJson(name, value);
		return value;
	}
	try {
		return `${JSON.stringify(lispToJson(value), null, 2)}\n`;
	} catch (ex) {
		throw new EvalException(
			`${name} takes data JSON can hold: ${ex instanceof Error ? ex.message : String(ex)}`,
			value,
		);
	}
}

export function encodeFile(name: string, value: unknown): string {
	if (extensionOf(name) === "ptc") return printFile(value);
	if (extensionOf(name) === "json") return encodeJson(name, value);
	if (typeof value !== "string")
		throw new EvalException(
			`${name} holds text, so write a string; only a .ptc or .json file takes data`,
			value,
		);
	return value;
}

function readsAsOneForm(source: string): unknown {
	const reader = new Reader();
	reader.push(source);
	if (reader.isEmpty()) return null;
	const value = reader.read();
	try {
		reader.read();
	} catch (ex) {
		if (ex === EndOfFile) return value;
		throw ex;
	}
	throw new Error("more than one form");
}

export function parseFile(path: string, source: string): unknown {
	try {
		return readsAsOneForm(source);
	} catch (ex) {
		throw new EvalException(
			`${path} is not one data form: ${ex instanceof Error ? ex.message : String(ex)}`,
			path,
		);
	}
}

export function printFile(value: unknown): string {
	const source = str(value);
	let back: unknown;
	try {
		back = readsAsOneForm(source);
	} catch {
		back = undefined;
	}
	if (back === undefined || str(back) !== source)
		throw new EvalException(
			"only data can be written to a file, and this does not read back",
			value,
		);
	return `${source}\n`;
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

	interp.defGen(
		"files",
		0,
		"(files)",
		"Return the names of the files the user uploaded to the workspace, as strings.",
		z.tuple([]),
		function* (): Eval {
			return arrayToList(yield* settled(store.files()));
		},
	);

	interp.defGen(
		"file/read",
		1,
		'(file/read "name")',
		"Read a workspace file. A .ptc file gives its one form as data, never run; a .json file gives its JSON as data; any other text file gives its text as a string. A binary file is refused. Returns nil when there is no such file.",
		z.tuple([zString]),
		function* ([name]): Eval {
			const checked = text("a file name", name);
			const bytes = yield* settled(store.file(checked));
			return bytes === undefined ? null : readFile(checked, bytes);
		},
	);

	interp.defGen(
		FILE_WRITE,
		2,
		'(file/write "name" value)',
		"Write a workspace file, replacing what it held. The user approves it first. A .ptc file takes any data and stores it printed; a .json file takes data and stores it as JSON, or takes a string of JSON text; any other file takes a string. Returns the name.",
		z.tuple([zString, zAny]),
		function* ([name, value]): Eval {
			const checked = text("a file name", name);
			yield* settled(
				store.write(
					checked,
					encodeFile(checked, value),
					contentTypeOf(checked),
				),
			);
			return checked;
		},
	);

	interp.defGen(
		FILE_DELETE,
		1,
		'(file/delete "name")',
		"Delete a workspace file. The user approves it first.",
		z.tuple([zString]),
		function* ([name]): Eval {
			yield* settled(store.remove(text("a file name", name)));
			return true;
		},
	);
}

export function workspaceExtension(host: WorkspaceHost): WorkspaceExtension {
	return Object.assign(
		(interp: Interp): void => registerWorkspace(interp, host),
		{
			asks: [SETTINGS_SET, CHAT_ARCHIVE, CHAT_READ, FILE_WRITE, FILE_DELETE],
			prompt: host.prompt(),
		},
	);
}
