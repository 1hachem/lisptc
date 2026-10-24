import { EvalException } from "@repo/interpreter/errors";
import { EndOfFile } from "@repo/interpreter/objects";
import { Reader } from "@repo/interpreter/reader";
import { formsOnly } from "@repo/shared/lisp-forms";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
	type Diagnostic,
	DiagnosticSeverity,
} from "vscode-languageserver-types";

export const UNCLOSED = "unclosed";

export interface SyntaxError_ {
	message: string;
	line: number;
	code?: typeof UNCLOSED;
}

export function checkSyntax(text: string): SyntaxError_[] {
	const tokens = new Reader();
	tokens.push(formsOnly(text));
	while (!tokens.isEmpty()) {
		try {
			tokens.read();
		} catch (ex) {
			if (ex === EndOfFile)
				return [
					{
						message: "unexpected end of input (unbalanced parentheses?)",
						line: tokens.line,
						code: UNCLOSED,
					},
				];
			if (ex instanceof EvalException)
				return [{ message: String(ex.message), line: tokens.line }];
			throw ex;
		}
	}
	return [];
}

export function syntaxDiagnostics(document: TextDocument): Diagnostic[] {
	return checkSyntax(document.getText()).map((err) => {
		const line = Math.min(err.line, document.lineCount) - 1;
		return {
			severity: DiagnosticSeverity.Error,
			range: {
				start: { line, character: 0 },
				end: { line: line + 1, character: 0 },
			},
			message: err.message,
			source: "lisptc",
			code: err.code,
		};
	});
}
