import { COMPLETION_TRIGGERS } from "@repo/language-service";
import {
	CodeActionKind,
	type ServerCapabilities,
	TextDocumentSyncKind,
} from "vscode-languageserver/node.js";

export const capabilities: ServerCapabilities = {
	textDocumentSync: TextDocumentSyncKind.Incremental,
	completionProvider: { triggerCharacters: [...COMPLETION_TRIGGERS] },
	hoverProvider: true,
	signatureHelpProvider: { triggerCharacters: [" ", ":"] },
	codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
};
