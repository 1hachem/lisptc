const PARENTHESIZED_PROSE =
	/^(?:\(\s*"(?:\\.|[^"\\])*"\s*\)|\(\s*(?![+*/<>=-]+(?:\s|\)))(?![a-z][a-z0-9-]*[/_][a-z0-9_/-]*\s*\))(?![\s\S]*\s:[a-z][a-z0-9-]*(?=\s|\)))(?![\s\S]*"(?:\\.|[^"\\])*")(?![\s\S]*(?:\s|\()['`~,@])(?=\s*(?:\d|\p{Lu}\p{Ll}+\b)|[\s\S]*(?:[,:%/…—&]|https?:\/\/|[^\p{ASCII}]))[\s\S]*\))$/u;

export function parenthesizedProsePattern(): RegExp {
	return new RegExp(PARENTHESIZED_PROSE.source, PARENTHESIZED_PROSE.flags);
}

export function looksLikeParenthesizedProse(source: string): boolean {
	return parenthesizedProsePattern().test(source);
}
