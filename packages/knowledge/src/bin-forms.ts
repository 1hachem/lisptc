import { type Eval, settled } from "@repo/interpreter/drive";
import type { Interp } from "@repo/interpreter/lisp";
import { arrayToList } from "@repo/interpreter/objects";
import { zString } from "@repo/interpreter/schema";
import { z } from "zod";
import { anyName } from "./names.ts";
import type { KnowledgeHost } from "./ports.ts";

const BIN_RESTORE = "bin/restore";
const BIN_DELETE = "bin/delete";

export const BIN_ASKS = [BIN_RESTORE, BIN_DELETE] as const;

export function registerBin(interp: Interp, { store }: KnowledgeHost): void {
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
			const restored = yield* settled(store.restore(anyName(name)));
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
			yield* settled(store.erase(anyName(name)));
			return true;
		},
	);
}
