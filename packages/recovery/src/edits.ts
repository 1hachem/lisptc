import { tokenPattern } from "@repo/shared/lisp-tokens";

export class EditFailure extends Error {}

interface Token {
	text: string;
	start: number;
	end: number;
}

function tokensOf(source: string): Token[] {
	const tokens: Token[] = [];
	let offset = 0;
	for (const line of source.split("\n")) {
		const pattern = tokenPattern();
		for (;;) {
			const m = pattern.exec(line);
			if (m === null) break;
			if (m[1] !== undefined)
				tokens.push({
					text: m[1],
					start: offset + m.index,
					end: offset + m.index + m[1].length,
				});
		}
		offset += line.length + 1;
	}
	return tokens;
}

export function replaceOnce(source: string, old: string, next: string): string {
	const at = old === "" ? -1 : source.indexOf(old);
	if (at === -1) throw new EditFailure(`not found in rejected: ${old}`);
	if (source.indexOf(old, at + 1) !== -1)
		throw new EditFailure(
			`found more than once in rejected, quote more around it: ${old}`,
		);
	return source.slice(0, at) + next + source.slice(at + old.length);
}

export function renameSymbol(source: string, from: string, to: string): string {
	const hits = tokensOf(source).filter((t) => t.text === from);
	if (hits.length === 0) throw new EditFailure(`${from} is not in rejected`);
	let out = source;
	for (const t of hits.reverse())
		out = out.slice(0, t.start) + to + out.slice(t.end);
	return out;
}

export function closeParens(source: string): string {
	let open = 0;
	for (const t of tokensOf(source)) {
		if (t.text === "(") open += 1;
		else if (t.text === ")" && open > 0) open -= 1;
	}
	if (open === 0) throw new EditFailure("no parenthesis is left open");
	return source.trimEnd() + ")".repeat(open);
}

interface CallSpan {
	tokens: Token[];
	close: Token;
}

function callOf(source: string, name: string): CallSpan {
	const tokens = tokensOf(source);
	const spans: CallSpan[] = [];
	for (let i = 0; i < tokens.length - 1; i++) {
		if (tokens[i].text !== "(" || tokens[i + 1].text !== name) continue;
		let depth = 0;
		for (let j = i; j < tokens.length; j++) {
			if (tokens[j].text === "(") depth += 1;
			else if (tokens[j].text === ")") depth -= 1;
			if (depth === 0) {
				spans.push({ tokens: tokens.slice(i, j + 1), close: tokens[j] });
				break;
			}
		}
	}
	if (spans.length === 0)
		throw new EditFailure(`no closed call to ${name} in rejected`);
	if (spans.length > 1)
		throw new EditFailure(
			`${name} is called ${spans.length} times in rejected, use revise on the one to change`,
		);
	return spans[0];
}

function insertAt(source: string, at: number, text: string): string {
	return source.slice(0, at) + text + source.slice(at);
}

export function addArgument(source: string, name: string, arg: string): string {
	const { close } = callOf(source, name);
	return insertAt(source, close.start, ` ${arg}`);
}

export function pushPositional(
	source: string,
	name: string,
	arg: string,
): string {
	const { tokens, close } = callOf(source, name);
	let depth = 0;
	for (const t of tokens.slice(2)) {
		if (t.text === "(") depth += 1;
		else if (t.text === ")") depth -= 1;
		else if (depth === 0 && t.text.startsWith(":"))
			return insertAt(source, t.start, `${arg} `);
	}
	return insertAt(source, close.start, ` ${arg}`);
}
