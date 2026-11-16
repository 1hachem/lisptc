import { EvalException, messageOf } from "@repo/interpreter/errors";
import { exactJsonToLisp, lispToJson } from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import type { Awaitable } from "@repo/shared/host";
import type { PdfReader } from "./ports.ts";

export interface FormReader {
	readAll(text: string): unknown[];
}

export interface Codec {
	readonly contentType: string;
	read(
		name: string,
		bytes: Uint8Array,
		pdf: PdfReader,
		forms: FormReader,
	): Awaitable<unknown>;
	write(name: string, value: unknown, forms: FormReader): string;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

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

function textOnly(name: string, value: unknown): string {
	if (typeof value !== "string")
		throw new EvalException(
			`${name} holds text, so write a string; only a .ptc or .json file takes data`,
			value,
		);
	return value;
}

function text(contentType: string): Codec {
	return { contentType, read: textOf, write: textOnly };
}

function parseJson(name: string, source: string): unknown {
	try {
		return exactJsonToLisp(JSON.parse(source));
	} catch (ex) {
		throw new EvalException(`${name} is not JSON: ${messageOf(ex)}`, name);
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
			`${name} takes data JSON can hold: ${messageOf(ex)}`,
			value,
		);
	}
}

function readsAsOneForm(forms: FormReader, source: string): unknown {
	const read = forms.readAll(source);
	if (read.length > 1) throw new Error("more than one form");
	return read.length === 0 ? null : read[0];
}

function parseForm(forms: FormReader, name: string, source: string): unknown {
	try {
		return readsAsOneForm(forms, source);
	} catch (ex) {
		throw new EvalException(
			`${name} is not one data form: ${messageOf(ex)}`,
			name,
		);
	}
}

function printForm(forms: FormReader, value: unknown): string {
	const source = str(value);
	let back: unknown;
	try {
		back = readsAsOneForm(forms, source);
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

async function pdfText(
	pdf: PdfReader,
	name: string,
	bytes: Uint8Array,
): Promise<string> {
	try {
		return await pdf.text(bytes);
	} catch (ex) {
		throw new EvalException(
			`${name} is not a readable PDF: ${messageOf(ex)}`,
			name,
		);
	}
}

const PLAIN = text("text/plain");

export const CODECS: ReadonlyMap<string, Codec> = new Map<string, Codec>([
	["csv", text("text/csv")],
	["htm", text("text/html")],
	["html", text("text/html")],
	[
		"json",
		{
			contentType: "application/json",
			read: (name, bytes) => parseJson(name, textOf(name, bytes)),
			write: encodeJson,
		},
	],
	["md", text("text/markdown")],
	["pdf", { ...PLAIN, read: (name, bytes, pdf) => pdfText(pdf, name, bytes) }],
	[
		"ptc",
		{
			contentType: "text/plain",
			read: (name, bytes, _pdf, forms) =>
				parseForm(forms, name, textOf(name, bytes)),
			write: (_name, value, forms) => printForm(forms, value),
		},
	],
	["svg", text("image/svg+xml")],
	["txt", PLAIN],
	["xml", text("application/xml")],
	["yaml", text("application/yaml")],
	["yml", text("application/yaml")],
]);

export function codecFor(name: string): Codec {
	const dot = name.lastIndexOf(".");
	const extension = dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
	return CODECS.get(extension) ?? PLAIN;
}
