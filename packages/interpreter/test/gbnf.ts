// A small GBNF (llama.cpp / Fireworks flavour) recogniser, used by the tests to
// check that a `.gbnf` grammar accepts / rejects a given string. It supports the
// subset the project's grammars use: rules (`name ::= …`), alternation `|`,
// sequencing, postfix `* + ?`, grouping `( … )`, string literals, character
// classes (with `^` negation, ranges and `\t \r \n \" \\ \uXXXX \UXXXXXXXX \xXX`
// escapes) and the `.` any-char wildcard. Matching is over Unicode code points,
// so astral characters (e.g. emoji) count as one.

type Node =
	| { t: "ref"; id: number; name: string }
	| { t: "seq"; id: number; items: Node[] }
	| { t: "alt"; id: number; opts: Node[] }
	| { t: "star"; id: number; node: Node }
	| { t: "plus"; id: number; node: Node }
	| { t: "opt"; id: number; node: Node }
	| { t: "lit"; id: number; cps: number[] }
	| { t: "class"; id: number; neg: boolean; ranges: [number, number][] }
	| { t: "any"; id: number };

export interface Grammar {
	rules: Map<string, Node>;
	start: string;
}

type Tok =
	| { k: "name"; v: string }
	| { k: "def" }
	| { k: "|" }
	| { k: "(" }
	| { k: ")" }
	| { k: "*" }
	| { k: "+" }
	| { k: "?" }
	| { k: "." }
	| { k: "str"; cps: number[] }
	| { k: "class"; neg: boolean; ranges: [number, number][] };

const HEX = (s: string) => Number.parseInt(s, 16);

// Decode one backslash escape starting at `s[i]` (which is the char after `\`).
// Returns [codePoint, nextIndex].
function decodeEscape(s: string, i: number): [number, number] {
	const c = s[i];
	const simple: Record<string, number> = {
		n: 10,
		r: 13,
		t: 9,
		f: 12,
		b: 8,
		"0": 0,
		"\\": 92,
		'"': 34,
		"'": 39,
		"]": 93,
		"[": 91,
		"-": 45,
		".": 46,
		"`": 96,
	};
	if (c === "u") return [HEX(s.slice(i + 1, i + 5)), i + 5];
	if (c === "U") return [HEX(s.slice(i + 1, i + 9)), i + 9];
	if (c === "x") return [HEX(s.slice(i + 1, i + 3)), i + 3];
	if (c in simple) return [simple[c], i + 1];
	return [c.codePointAt(0) as number, i + 1];
}

function tokenize(src: string): Tok[] {
	const toks: Tok[] = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (c === " " || c === "\t" || c === "\r" || c === "\n") {
			i++;
			continue;
		}
		if (c === "#") {
			while (i < src.length && src[i] !== "\n") i++;
			continue;
		}
		if (c === ":") {
			if (src.slice(i, i + 3) !== "::=")
				throw new Error(`expected ::= at ${i}`);
			toks.push({ k: "def" });
			i += 3;
			continue;
		}
		if (
			c === "|" ||
			c === "(" ||
			c === ")" ||
			c === "*" ||
			c === "+" ||
			c === "?"
		) {
			toks.push({ k: c } as Tok);
			i++;
			continue;
		}
		if (c === ".") {
			toks.push({ k: "." });
			i++;
			continue;
		}
		if (c === '"') {
			const cps: number[] = [];
			i++;
			while (i < src.length && src[i] !== '"') {
				if (src[i] === "\\") {
					const [cp, ni] = decodeEscape(src, i + 1);
					cps.push(cp);
					i = ni;
				} else {
					const cp = src.codePointAt(i) as number;
					cps.push(cp);
					i += cp > 0xffff ? 2 : 1;
				}
			}
			if (src[i] !== '"') throw new Error("unterminated string literal");
			i++;
			toks.push({ k: "str", cps });
			continue;
		}
		if (c === "[") {
			i++;
			let neg = false;
			if (src[i] === "^") {
				neg = true;
				i++;
			}
			const ranges: [number, number][] = [];
			while (i < src.length && src[i] !== "]") {
				let lo: number;
				if (src[i] === "\\") {
					const [cp, ni] = decodeEscape(src, i + 1);
					lo = cp;
					i = ni;
				} else {
					lo = src.codePointAt(i) as number;
					i += lo > 0xffff ? 2 : 1;
				}
				let hi = lo;
				if (src[i] === "-" && src[i + 1] !== "]") {
					i++;
					if (src[i] === "\\") {
						const [cp, ni] = decodeEscape(src, i + 1);
						hi = cp;
						i = ni;
					} else {
						hi = src.codePointAt(i) as number;
						i += hi > 0xffff ? 2 : 1;
					}
				}
				ranges.push([lo, hi]);
			}
			if (src[i] !== "]") throw new Error("unterminated character class");
			i++;
			toks.push({ k: "class", neg, ranges });
			continue;
		}
		if (/[A-Za-z0-9_-]/.test(c)) {
			let j = i;
			while (j < src.length && /[A-Za-z0-9_-]/.test(src[j])) j++;
			toks.push({ k: "name", v: src.slice(i, j) });
			i = j;
			continue;
		}
		throw new Error(`unexpected char ${JSON.stringify(c)} at ${i}`);
	}
	return toks;
}

export function parseGrammar(src: string): Grammar {
	const toks = tokenize(src);
	let p = 0;
	let nextId = 0;
	const id = () => nextId++;
	const peek = () => toks[p];
	const rules = new Map<string, Node>();
	let start: string | undefined;

	const parseExpr = (): Node => {
		const opts = [parseSeq()];
		while (peek()?.k === "|") {
			p++;
			opts.push(parseSeq());
		}
		return opts.length === 1 ? opts[0] : { t: "alt", id: id(), opts };
	};

	const parseSeq = (): Node => {
		const items: Node[] = [];
		for (;;) {
			const t = peek();
			if (!t || t.k === "|" || t.k === ")") break;
			// A `name ::=` ahead starts the next rule — stop this sequence.
			if (t.k === "name" && toks[p + 1]?.k === "def") break;
			items.push(parsePostfix());
		}
		if (items.length === 0) throw new Error("empty sequence");
		return items.length === 1 ? items[0] : { t: "seq", id: id(), items };
	};

	const parsePostfix = (): Node => {
		let node = parsePrimary();
		const t = peek();
		if (t?.k === "*") {
			p++;
			node = { t: "star", id: id(), node };
		} else if (t?.k === "+") {
			p++;
			node = { t: "plus", id: id(), node };
		} else if (t?.k === "?") {
			p++;
			node = { t: "opt", id: id(), node };
		}
		return node;
	};

	const parsePrimary = (): Node => {
		const t = peek();
		if (!t) throw new Error("unexpected end of grammar");
		if (t.k === "(") {
			p++;
			const e = parseExpr();
			if (peek()?.k !== ")") throw new Error("expected )");
			p++;
			return e;
		}
		if (t.k === "str") {
			p++;
			return { t: "lit", id: id(), cps: t.cps };
		}
		if (t.k === "class") {
			p++;
			return { t: "class", id: id(), neg: t.neg, ranges: t.ranges };
		}
		if (t.k === ".") {
			p++;
			return { t: "any", id: id() };
		}
		if (t.k === "name") {
			p++;
			return { t: "ref", id: id(), name: t.v };
		}
		throw new Error(`unexpected token ${t.k}`);
	};

	while (p < toks.length) {
		const nameTok = peek();
		if (nameTok?.k !== "name") throw new Error("expected rule name");
		p++;
		if (peek()?.k !== "def") throw new Error("expected ::=");
		p++;
		const body = parseExpr();
		rules.set(nameTok.v, body);
		if (start === undefined) start = nameTok.v;
	}
	if (start === undefined) throw new Error("empty grammar");
	if (rules.has("root")) start = "root";
	return { rules, start };
}

// Return the set of end positions reachable by matching `node` at `pos`.
function matcher(g: Grammar, cps: number[]) {
	const memo = new Map<string, Set<number>>();

	const match = (node: Node, pos: number): Set<number> => {
		const key = `${node.id}:${pos}`;
		const cached = memo.get(key);
		if (cached) return cached;
		// Guard against left-recursive cycles (our grammars have none, but be safe).
		memo.set(key, new Set());
		const out = compute(node, pos);
		memo.set(key, out);
		return out;
	};

	const compute = (node: Node, pos: number): Set<number> => {
		switch (node.t) {
			case "ref": {
				const rule = g.rules.get(node.name);
				if (!rule) throw new Error(`undefined rule ${node.name}`);
				return match(rule, pos);
			}
			case "lit": {
				for (let k = 0; k < node.cps.length; k++) {
					if (cps[pos + k] !== node.cps[k]) return new Set();
				}
				return new Set([pos + node.cps.length]);
			}
			case "any":
				return pos < cps.length ? new Set([pos + 1]) : new Set();
			case "class": {
				if (pos >= cps.length) return new Set();
				const cp = cps[pos];
				const inRange = node.ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
				return inRange !== node.neg ? new Set([pos + 1]) : new Set();
			}
			case "alt": {
				const out = new Set<number>();
				for (const o of node.opts) for (const e of match(o, pos)) out.add(e);
				return out;
			}
			case "seq": {
				let frontier = new Set([pos]);
				for (const item of node.items) {
					const next = new Set<number>();
					for (const f of frontier) for (const e of match(item, f)) next.add(e);
					if (next.size === 0) return new Set();
					frontier = next;
				}
				return frontier;
			}
			case "opt": {
				const out = match(node.node, pos);
				out.add(pos);
				return out;
			}
			case "star":
			case "plus": {
				const seen = new Set<number>();
				const work = [...match(node.node, pos)];
				for (const e of work) seen.add(e);
				while (work.length) {
					const cur = work.pop() as number;
					for (const e of match(node.node, cur)) {
						if (!seen.has(e)) {
							seen.add(e);
							work.push(e);
						}
					}
				}
				if (node.t === "star") seen.add(pos);
				return seen;
			}
		}
	};

	return (node: Node, pos: number) => match(node, pos);
}

/** Does `grammar` accept the whole of `input`? */
export function accepts(g: Grammar, input: string): boolean {
	const cps = Array.from(input, (ch) => ch.codePointAt(0) as number);
	const run = matcher(g, cps);
	return run({ t: "ref", id: -1, name: g.start }, 0).has(cps.length);
}
