import { type Eval, settled } from "@repo/interpreter/drive";
import type { Interp } from "@repo/interpreter/lisp";
import { arrayToList } from "@repo/interpreter/objects";
import { zAny, zString } from "@repo/interpreter/schema";
import { z } from "zod";
import { codecFor } from "./codecs.ts";
import { fileName } from "./names.ts";
import type { KnowledgeHost } from "./ports.ts";

const KNOWLEDGE_WRITE = "knowledge/write";
const KNOWLEDGE_DELETE = "knowledge/delete";

export const KNOWLEDGE_ASKS = [KNOWLEDGE_WRITE, KNOWLEDGE_DELETE] as const;

export function registerKnowledge(
	interp: Interp,
	{ store, pdf }: KnowledgeHost,
): void {
	interp.defGen(
		"knowledge/list",
		0,
		"(knowledge/list)",
		"Return the names of the knowledge files the user uploaded to the workspace, as strings.",
		z.tuple([]),
		function* (): Eval {
			return arrayToList(yield* settled(store.names("knowledge")));
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
			const bytes = yield* settled(store.read("knowledge", checked));
			return bytes === undefined
				? null
				: yield* settled(codecFor(checked).read(checked, bytes, pdf));
		},
	);

	interp.defGen(
		KNOWLEDGE_WRITE,
		2,
		'(knowledge/write "name" value)',
		"Write a knowledge file, moving what it held to the bin. The user approves it first. A .ptc file takes any data and stores it printed; a .json file takes data and stores it as JSON, or takes a string of JSON text; any other file takes a string. Returns the name.",
		z.tuple([zString, zAny]),
		function* ([name, value]): Eval {
			const checked = fileName(name);
			const codec = codecFor(checked);
			yield* settled(
				store.write(
					"knowledge",
					checked,
					new TextEncoder().encode(codec.write(checked, value)),
					codec.contentType,
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
			yield* settled(store.remove("knowledge", fileName(name)));
			return true;
		},
	);
}
