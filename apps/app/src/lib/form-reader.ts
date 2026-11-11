import {
	isKeywordToken,
	isQuoteToken,
	numberIn,
	tokenPattern,
} from "@repo/shared/lisp-tokens";

export type Datum =
	| { kind: "string"; value: string }
	| { kind: "number"; value: string }
	| { kind: "keyword"; name: string }
	| { kind: "symbol"; name: string }
	| { kind: "list"; items: Datum[] };

function tokensOf(text: string): string[] {
	return [...text.matchAll(tokenPattern())]
		.map((match) => match[1]?.trim())
		.filter((token): token is string => token !== undefined && token !== "");
}

function atom(token: string): Datum {
	if (token.startsWith('"')) {
		try {
			return { kind: "string", value: JSON.parse(token) as string };
		} catch {
			return { kind: "string", value: token.slice(1, -1) };
		}
	}
	if (isKeywordToken(token)) return { kind: "keyword", name: token.slice(1) };
	if (numberIn(token) !== null) return { kind: "number", value: token };
	return { kind: "symbol", name: token };
}

export function readForms(text: string): Datum[] | undefined {
	const tokens = tokensOf(text);
	let at = 0;
	const read = (): Datum | undefined => {
		const token = tokens[at++];
		if (token === undefined || token === ")") return undefined;
		if (isQuoteToken(token)) return read();
		if (token !== "(") return atom(token);
		const items: Datum[] = [];
		while (tokens[at] !== ")") {
			if (at >= tokens.length) return undefined;
			const item = read();
			if (item === undefined) return undefined;
			items.push(item);
		}
		at++;
		return { kind: "list", items };
	};
	const forms: Datum[] = [];
	while (at < tokens.length) {
		const form = read();
		if (form === undefined) return undefined;
		forms.push(form);
	}
	return forms;
}

export function readForm(text: string): Datum | undefined {
	const forms = readForms(text);
	return forms?.length === 1 ? forms[0] : undefined;
}

function headOf(form: Datum | undefined): string | undefined {
	if (form?.kind !== "list") return undefined;
	const head = form.items[0];
	return head?.kind === "symbol" ? head.name : undefined;
}

export interface Call {
	head: string;
	args: Datum[];
	options: Map<string, Datum>;
}

export function callOf(form: Datum | undefined): Call | undefined {
	const head = headOf(form);
	if (head === undefined || form?.kind !== "list") return undefined;
	const args: Datum[] = [];
	const options = new Map<string, Datum>();
	const rest = form.items.slice(1);
	for (let i = 0; i < rest.length; i++) {
		const item = rest[i];
		if (item === undefined) continue;
		const value = rest[i + 1];
		if (item.kind === "keyword" && value !== undefined) {
			options.set(item.name, value);
			i++;
		} else {
			args.push(item);
		}
	}
	return { head, args, options };
}

export function plainText(datum: Datum): string {
	switch (datum.kind) {
		case "string":
			return datum.value;
		case "number":
			return datum.value;
		case "keyword":
		case "symbol":
			return datum.name;
		case "list":
			return datum.items.map(plainText).join(" ");
	}
}
