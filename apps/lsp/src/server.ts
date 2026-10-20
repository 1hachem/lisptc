import { fileURLToPath } from "node:url";
import { Interp, runSync } from "@repo/interpreter";
import { prelude } from "@repo/interpreter/prelude";
import {
	type LanguageService,
	languageService,
	symbolsOf,
	symbolTable,
} from "@repo/language-service";
import {
	connectOrSpawn,
	type SessionClient,
	socketPathFor,
} from "@repo/repl/session-server";
import {
	CodeActionKind,
	createConnection,
	ProposedFeatures,
	TextDocuments,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { capabilities } from "./capabilities.ts";
import { docExtensions } from "./extensions.ts";
import { cachedFor } from "./table-cache.ts";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const interp = new Interp({ extensions: docExtensions() });
runSync(interp, prelude);
const local = languageService(symbolTable(symbolsOf(interp)));

const SESSION_ENTRY = fileURLToPath(new URL("./session.ts", import.meta.url));

let session: SessionClient | undefined;
connectOrSpawn(socketPathFor(), SESSION_ENTRY)
	.then((client) => {
		session = client;
	})
	.catch(() => {});

const CACHE_MS = 400;

const fromSession = cachedFor(async () => {
	if (session === undefined) throw new Error("no session");
	return languageService(symbolTable(await session.symbols()));
}, CACHE_MS);

async function service(): Promise<LanguageService> {
	return fromSession().catch(() => local);
}

connection.onInitialize(() => ({ capabilities }));

documents.onDidChangeContent(async ({ document }) => {
	const diagnostics = (await service()).diagnostics(document);
	if (documents.get(document.uri)?.version !== document.version) return;
	connection.sendDiagnostics({ uri: document.uri, diagnostics });
});

connection.onCompletion(async ({ textDocument, position }) => {
	const document = documents.get(textDocument.uri);
	if (document === undefined) return [];
	return (await service()).completions(document, position);
});

connection.onHover(async ({ textDocument, position }) => {
	const document = documents.get(textDocument.uri);
	if (document === undefined) return null;
	return (await service()).hover(document, position);
});

connection.onSignatureHelp(async ({ textDocument, position }) => {
	const document = documents.get(textDocument.uri);
	if (document === undefined) return null;
	return (await service()).signatureHelp(document, position);
});

connection.onCodeAction(async ({ textDocument, range }) => {
	const document = documents.get(textDocument.uri);
	if (document === undefined) return [];
	const edit = (await service()).closer(document, range.end);
	if (edit === null) return [];
	return [
		{
			title: `close with ${edit.newText}`,
			kind: CodeActionKind.QuickFix,
			edit: { changes: { [textDocument.uri]: [edit] } },
		},
	];
});

documents.listen(connection);
connection.listen();
