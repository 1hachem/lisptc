export function tokenPattern(): RegExp {
	return /\s+|("(\\.?|.)*?"|,@?|[^()'`~" \t]+|.)/g;
}

const QUOTE_TOKENS = ["'", "`", ",", ",@"] as const;

export type QuoteToken = (typeof QUOTE_TOKENS)[number];

export function isQuoteToken(token: string): token is QuoteToken {
	return (QUOTE_TOKENS as readonly string[]).includes(token);
}

export function isKeywordToken(token: string): boolean {
	return token.length > 1 && token[0] === ":";
}

export function numberIn(token: string): bigint | number | null {
	try {
		return BigInt(token);
	} catch (_ex) {
		const n = Number(token);
		if (Number.isNaN(n)) return null;
		return n;
	}
}
