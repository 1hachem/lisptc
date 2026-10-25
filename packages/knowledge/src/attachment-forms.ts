import { type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import { arrayToList, Cell, listToArray } from "@repo/interpreter/objects";
import { plistOptions } from "@repo/interpreter/plist";
import { zAny, zList, zString } from "@repo/interpreter/schema";
import { z } from "zod";
import { base64Bytes } from "./base64.ts";
import { codecFor } from "./codecs.ts";
import { fetchedUrl, fileName, nameFromUrl } from "./names.ts";
import type { Downloaded, KnowledgeHost } from "./ports.ts";

const KNOWLEDGE_KEEP = "knowledge/keep";
const ATTACHMENTS_FETCH = "attachments/fetch";
const ATTACHMENTS_DELETE = "attachments/delete";

export const ATTACHMENT_ASKS = [
	KNOWLEDGE_KEEP,
	ATTACHMENTS_FETCH,
	ATTACHMENTS_DELETE,
] as const;

function written(name: string, value: unknown): Downloaded {
	if (typeof value === "string")
		return {
			bytes: new TextEncoder().encode(value),
			contentType: codecFor(name).contentType,
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

export function registerAttachments(
	interp: Interp,
	{ store, downloader, pdf }: KnowledgeHost,
): void {
	interp.defGen(
		"attachments/list",
		0,
		"(attachments/list)",
		"Return the names of the attachments, as strings: what the user attached to a message, or what attachments/write and attachments/fetch put there. They expire unless kept.",
		z.tuple([]),
		function* (): Eval {
			return arrayToList(yield* settled(store.names("attachments")));
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
			const bytes = yield* settled(store.read("attachments", checked));
			return bytes === undefined
				? null
				: yield* settled(codecFor(checked).read(checked, bytes, pdf));
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
			return yield* settled(
				store.write("attachments", checked, bytes, contentType),
			);
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
			const name = named === undefined ? nameFromUrl(url) : fileName(named);
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
				store.write("attachments", name, fetched.bytes, fetched.contentType),
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
			yield* settled(store.remove("attachments", fileName(name)));
			return true;
		},
	);

	interp.defGen(
		KNOWLEDGE_KEEP,
		1,
		'(knowledge/keep "name")',
		"Move a file from attachments into the knowledge folder, so it is kept for good and no longer expires. The user approves it first. Returns the name.",
		z.tuple([zString]),
		function* ([name]): Eval {
			const checked = fileName(name);
			yield* settled(store.keep(checked));
			return checked;
		},
	);
}
