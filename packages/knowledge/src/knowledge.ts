import { type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import {
	arrayToList,
	EndOfFile,
	jsonToLisp,
	lispToJson,
} from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import { Reader } from "@repo/interpreter/reader";
import { zAny } from "@repo/interpreter/schema";
import type { InterpExtension } from "@repo/interpreter/session";
import type { Awaitable } from "@repo/shared/host";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";
import type { KnowledgeHost } from "./ports.ts";

const KNOWLEDGE_WRITE = "knowledge/write";
const KNOWLEDGE_DELETE = "knowledge/delete";

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

function registerKnowledge(interp: Interp, { store }: KnowledgeHost): void {
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
		"Delete a knowledge file. The user approves it first.",
		z.tuple([zString]),
		function* ([name]): Eval {
			yield* settled(store.remove(fileName(name)));
			return true;
		},
	);
}

export function knowledgeExtension(host: KnowledgeHost): KnowledgeExtension {
	return Object.assign(
		(interp: Interp): void => registerKnowledge(interp, host),
		{
			asks: [KNOWLEDGE_WRITE, KNOWLEDGE_DELETE],
			prompt: host.prompt(),
		},
	);
}
