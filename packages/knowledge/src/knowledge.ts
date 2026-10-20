import { topic } from "@repo/interpreter/channels";
import { type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	EndOfFile,
	jsonToLisp,
	lispToJson,
	listToArray,
} from "@repo/interpreter/objects";
import { plistOptions } from "@repo/interpreter/plist";
import { str } from "@repo/interpreter/print";
import { Reader } from "@repo/interpreter/reader";
import { zAny, zList } from "@repo/interpreter/schema";
import {
	annotating,
	type InterpExtension,
	type SessionHooks,
} from "@repo/interpreter/session";
import type { Awaitable } from "@repo/shared/host";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";
import type { Downloaded, KnowledgeHost, StoreFolder } from "./ports.ts";

const KNOWLEDGE_WRITE = "knowledge/write";
const KNOWLEDGE_DELETE = "knowledge/delete";
const ATTACHMENTS_FETCH = "attachments/fetch";
const ATTACHMENTS_DELETE = "attachments/delete";
const BIN_RESTORE = "bin/restore";
const BIN_DELETE = "bin/delete";

const zString = z.custom<string>(
	(x) => typeof x === "string",
	"string expected",
);

export interface KnowledgeExtension extends InterpExtension {
	readonly asks: readonly string[];
}

function fileName(value: unknown): string {
	if (typeof value !== "string" || value.trim() === "")
		throw new EvalException("a file name must be a non-empty string", value);
	return value.trim();
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

function contentTypeOf(name: string): string {
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

async function pdfText(name: string, bytes: Uint8Array): Promise<string> {
	try {
		const pdf = await getDocumentProxy(bytes.slice());
		const { text } = await extractText(pdf, { mergePages: true });
		return text;
	} catch (ex) {
		throw new EvalException(
			`${name} is not a readable PDF: ${ex instanceof Error ? ex.message : String(ex)}`,
			name,
		);
	}
}

type Loader = (name: string, bytes: Uint8Array) => Awaitable<unknown>;

const LOADERS: Record<string, Loader> = {
	ptc: (name, bytes) => parseFile(name, textOf(name, bytes)),
	json: (name, bytes) => parseJson(name, textOf(name, bytes)),
	pdf: pdfText,
};

function readFile(name: string, bytes: Uint8Array): Awaitable<unknown> {
	return (LOADERS[extensionOf(name)] ?? textOf)(name, bytes);
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

function encodeFile(name: string, value: unknown): string {
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

function parseFile(path: string, source: string): unknown {
	try {
		return readsAsOneForm(source);
	} catch (ex) {
		throw new EvalException(
			`${path} is not one data form: ${ex instanceof Error ? ex.message : String(ex)}`,
			path,
		);
	}
}

function printFile(value: unknown): string {
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

function base64Bytes(name: string, encoded: unknown): Uint8Array {
	if (typeof encoded !== "string")
		throw new EvalException(`${name} takes :base64 as a string`, encoded);
	try {
		return Uint8Array.from(atob(encoded.replace(/\s+/g, "")), (c) =>
			c.charCodeAt(0),
		);
	} catch {
		throw new EvalException(`${name} :base64 is not base64`, encoded);
	}
}

function written(name: string, value: unknown): Downloaded {
	if (typeof value === "string")
		return {
			bytes: new TextEncoder().encode(value),
			contentType: contentTypeOf(name),
		};
	if (!(value instanceof Cell))
		throw new EvalException(
			`${name} takes a string, or (:base64 "…" :type "…") for bytes`,
			value,
		);
	const options = plistOptions(value, ["base64", "type"]);
	const type = options.get("type");
	return {
		bytes: base64Bytes(name, options.get("base64")),
		contentType:
			typeof type === "string" && type !== ""
				? type
				: "application/octet-stream",
	};
}

function fetchedUrl(value: unknown): URL {
	let url: URL | undefined;
	try {
		url = typeof value === "string" ? new URL(value) : undefined;
	} catch {
		url = undefined;
	}
	if (
		url === undefined ||
		(url.protocol !== "https:" && url.protocol !== "http:")
	)
		throw new EvalException("an http or https url expected", value);
	return url;
}

function nameFromUrl(url: URL): string {
	const last = decodeURIComponent(url.pathname.split("/").pop() ?? "").trim();
	return last === "" || last.startsWith(".") ? url.hostname : last;
}

function registerAttachments(
	interp: Interp,
	{ store, downloader }: KnowledgeHost,
): void {
	interp.defGen(
		"attachments/list",
		0,
		"(attachments/list)",
		"Return the names of the attachments, as strings: what the user attached to a message, or what attachments/write and attachments/fetch put there. They expire unless kept.",
		z.tuple([]),
		function* (): Eval {
			return arrayToList(yield* settled(store.attachments()));
		},
	);

	interp.defGen(
		"attachments/read",
		1,
		'(attachments/read "name")',
		"Read an attachment the way knowledge/read reads a knowledge file. Returns nil when there is no such file.",
		z.tuple([zString]),
		function* ([name]): Eval {
			const checked = fileName(name);
			const bytes = yield* settled(store.attachment(checked));
			return bytes === undefined
				? null
				: yield* settled(readFile(checked, bytes));
		},
	);

	interp.defGen(
		"attachments/write",
		2,
		'(attachments/write "name" value)',
		'Put a file in attachments. A string is stored as text under the type its name implies; (:base64 "…" :type "image/png") is stored as those bytes. Returns the name it was stored under, which gains a number when attachments already hold that name.',
		z.tuple([zString, zAny]),
		function* ([name, value]): Eval {
			const checked = fileName(name);
			const { bytes, contentType } = written(checked, value);
			return yield* settled(store.attach(checked, bytes, contentType));
		},
	);

	interp.defGen(
		ATTACHMENTS_FETCH,
		-1,
		'(attachments/fetch "https://…" ["name"])',
		"Download a url into attachments. The user approves it first. The name defaults to the last part of the url's path. Returns the name it was stored under.",
		z.tuple([zList]),
		function* ([rest]): Eval {
			const [target, named] = listToArray(rest);
			const url = fetchedUrl(target);
			const name = fileName(named ?? nameFromUrl(url));
			let fetched: Downloaded;
			try {
				fetched = yield* settled(downloader.download(url));
			} catch (ex) {
				throw new EvalException(
					`could not fetch ${url.href}: ${ex instanceof Error ? ex.message : String(ex)}`,
					target,
				);
			}
			return yield* settled(
				store.attach(name, fetched.bytes, fetched.contentType),
			);
		},
	);

	interp.defGen(
		ATTACHMENTS_DELETE,
		1,
		'(attachments/delete "name")',
		"Move an attachment to the bin. The user approves it first.",
		z.tuple([zString]),
		function* ([name]): Eval {
			yield* settled(store.unattach(fileName(name)));
			return true;
		},
	);

	interp.defGen(
		"knowledge/keep",
		1,
		'(knowledge/keep "name")',
		"Move a file from attachments into the knowledge folder, so it is kept for good and no longer expires. Returns the name.",
		z.tuple([zString]),
		function* ([name]): Eval {
			const checked = fileName(name);
			yield* settled(store.keep(checked));
			return checked;
		},
	);
}

function registerKnowledge(interp: Interp, host: KnowledgeHost): void {
	const { store } = host;
	registerAttachments(interp, host);
	interp.defGen(
		"knowledge/list",
		0,
		"(knowledge/list)",
		"Return the names of the knowledge files the user uploaded to the workspace, as strings.",
		z.tuple([]),
		function* (): Eval {
			return arrayToList(yield* settled(store.files()));
		},
	);

	interp.defGen(
		"knowledge/read",
		1,
		'(knowledge/read "name")',
		"Read a knowledge file. A .ptc file gives its one form as data, never run; a .json file gives its JSON as data; a .pdf file gives the text of its pages as a string; any other text file gives its text as a string. Any other binary file is refused. Returns nil when there is no such file.",
		z.tuple([zString]),
		function* ([name]): Eval {
			const checked = fileName(name);
			const bytes = yield* settled(store.file(checked));
			return bytes === undefined
				? null
				: yield* settled(readFile(checked, bytes));
		},
	);

	interp.defGen(
		KNOWLEDGE_WRITE,
		2,
		'(knowledge/write "name" value)',
		"Write a knowledge file, replacing what it held. The user approves it first. A .ptc file takes any data and stores it printed; a .json file takes data and stores it as JSON, or takes a string of JSON text; any other file takes a string. Returns the name.",
		z.tuple([zString, zAny]),
		function* ([name, value]): Eval {
			const checked = fileName(name);
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
		KNOWLEDGE_DELETE,
		1,
		'(knowledge/delete "name")',
		"Move a knowledge file to the bin. The user approves it first.",
		z.tuple([zString]),
		function* ([name]): Eval {
			yield* settled(store.remove(fileName(name)));
			return true;
		},
	);
}

function registerBin(interp: Interp, { store }: KnowledgeHost): void {
	interp.defGen(
		"bin/list",
		0,
		"(bin/list)",
		"Return the names of the files in the bin, newest first: what was deleted from knowledge or attachments, or what expired from attachments. The bin deletes them for good a month later.",
		z.tuple([]),
		function* (): Eval {
			const binned = yield* settled(store.binned());
			return arrayToList(binned.map(({ name }) => name));
		},
	);

	interp.defGen(
		"bin/search",
		1,
		'(bin/search "text")',
		"Return the names of the files in the bin whose name holds the text, ignoring case.",
		z.tuple([zString]),
		function* ([text]): Eval {
			const needle = text.toLowerCase();
			const binned = yield* settled(store.binned());
			return arrayToList(
				binned
					.map(({ name }) => name)
					.filter((name) => name.toLowerCase().includes(needle)),
			);
		},
	);

	interp.defGen(
		BIN_RESTORE,
		1,
		'(bin/restore "name")',
		'Move a file out of the bin, back into the folder it was deleted from. The user approves it first. Returns where it went, as "folder/name".',
		z.tuple([zString]),
		function* ([name]): Eval {
			const restored = yield* settled(store.restore(fileName(name)));
			return `${restored.from}/${restored.name}`;
		},
	);

	interp.defGen(
		BIN_DELETE,
		1,
		'(bin/delete "name")',
		"Delete a file in the bin for good. The user approves it first.",
		z.tuple([zString]),
		function* ([name]): Eval {
			yield* settled(store.erase(fileName(name)));
			return true;
		},
	);
}

export type AttachedFolder = StoreFolder;

export interface AttachedFile {
	folder: AttachedFolder;
	name: string;
}

export const attached = topic<AttachedFile>("attachments");

function registerAttach(interp: Interp, { store }: KnowledgeHost): void {
	const held: Record<AttachedFolder, () => Awaitable<string[]>> = {
		attachments: () => store.attachments(),
		knowledge: () => store.files(),
	};
	for (const folder of ["attachments", "knowledge"] as const)
		interp.defGen(
			`${folder}/attach`,
			1,
			`(${folder}/attach "name")`,
			`Attach a ${folder} file to your reply, so the user sees it under the message and opens it with a click. Errors when there is no such file. Returns the name.`,
			z.tuple([zString]),
			function* ([name]): Eval {
				const checked = fileName(name);
				if (!(yield* settled(held[folder]())).includes(checked))
					throw new EvalException(
						`no file named ${checked} in ${folder}`,
						name,
					);
				attached.emit(interp.channels, { user: { folder, name: checked } });
				return checked;
			},
		);
}

function attachSession(hooks: SessionHooks): void {
	hooks.annotate.use((buffer, into, next) => {
		const attachments = buffer.collect(attached);
		return next(
			buffer,
			attachments.length === 0
				? into
				: annotating(into, "output", { attachments }),
		);
	});
}

export function knowledgeExtension(host: KnowledgeHost): KnowledgeExtension {
	return Object.assign(
		(interp: Interp): void => {
			registerKnowledge(interp, host);
			registerAttach(interp, host);
			registerBin(interp, host);
		},
		{
			asks: [
				KNOWLEDGE_WRITE,
				KNOWLEDGE_DELETE,
				ATTACHMENTS_FETCH,
				ATTACHMENTS_DELETE,
				BIN_RESTORE,
				BIN_DELETE,
			],
			prompt: host.prompt(),
			session: attachSession,
		},
	);
}
