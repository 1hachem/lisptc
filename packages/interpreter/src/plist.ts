/*
 * Keyword-plist argument parsing, shared by every built-in called with native
 * keyword syntax — (linear/list-issues :query "auth"), (view x :offset 400).
 *
 * This lives apart from src/mcp.ts, which grew it first, because mcp.ts carries
 * the @modelcontextprotocol/sdk dependency: a consumer that only wants keyword
 * args (src/compression.ts) must not pull the MCP SDK in behind it.
 */
import {
	EvalException,
	LispKeyword,
	type List,
	newLispKeyword,
	Sym,
} from "./lisp.ts";

// Extract the string name from a :keyword, symbol, or string key.
export function keyName(key: unknown): string {
	if (key instanceof LispKeyword) return key.name;
	if (key instanceof Sym) return key.name;
	if (typeof key === "string") return key;
	throw new EvalException("keyword expected as key", key);
}

// Parse a keyword plist (:k1 v1 :k2 v2 ...) into a Map of name -> raw Lisp value.
export function parsePlist(list: List): Map<string, unknown> {
	const out = new Map<string, unknown>();
	let j = list;
	while (j !== null) {
		const key = j.car;
		const rest = j.cdr as List;
		if (rest === null)
			throw new EvalException(
				"odd-length keyword list; missing value for",
				key,
			);
		const name = keyName(key);
		out.set(name, rest.car);
		j = rest.cdr as List;
	}
	return out;
}

/*
 * Parse a plist of options, rejecting any key not in `allowed`.
 *
 * Stricter than parsePlist, which an MCP tool call needs to stay lenient about
 * (its keys come from a remote schema). For a built-in the keys are fixed and a
 * silently-ignored typo is worse than an error: an agent that writes
 * (view x :ofset 400) must be told, not handed the first 400 words as if it had
 * asked for them.
 */
export function plistOptions(
	list: List,
	allowed: readonly string[],
): Map<string, unknown> {
	const opts = parsePlist(list);
	for (const name of opts.keys())
		if (!allowed.includes(name))
			throw new EvalException(
				`unknown option; expected one of ${allowed.map((a) => `:${a}`).join(" ")}`,
				newLispKeyword(name),
			);
	return opts;
}
