import { openAtEnd } from "@repo/shared/lisp-forms";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { Position, TextEdit } from "vscode-languageserver-types";

const QUOTE_AHEAD = /^(?:[^"\\\n]|\\.)*"/;

function insertAt(position: Position, newText: string): TextEdit {
	return { range: { start: position, end: position }, newText };
}

export function closerAt(
	document: TextDocument,
	position: Position,
): TextEdit | null {
	const text = document.getText();
	const offset = document.offsetAt(position);
	const before = openAtEnd(text.slice(0, offset));
	if (before.inString)
		return QUOTE_AHEAD.test(text.slice(offset))
			? null
			: insertAt(position, '"');
	const open = before.parens.at(-1);
	if (open === undefined || !openAtEnd(text).parens.includes(open)) return null;
	return insertAt(position, ")");
}
