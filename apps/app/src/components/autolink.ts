import type { InlineNode, MarkdownExtension } from "@tanstack/markdown";

const AUTOLINK =
	/<(?<bracketed>[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>@]+)>|(?<=^|[\s*_~(])(?<bare>(?:https?:\/\/|www\.)[^\s<]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

const EMAIL = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const SAFE_SCHEME = /^(?:https?|mailto|tel):/i;
const ENTITY = /&[a-zA-Z0-9]+;$/;
const TRAILING = "?!.,:*_~";

function unbalanced(value: string) {
	let open = 0;
	for (const char of value) {
		if (char === "(") open += 1;
		else if (char === ")") open -= 1;
	}
	return open < 0;
}

function trimTrailing(value: string) {
	let end = value.length;
	while (end > 0) {
		const char = value[end - 1] as string;
		if (TRAILING.includes(char)) {
			end -= 1;
			continue;
		}
		if (char === ")" && unbalanced(value.slice(0, end))) {
			end -= 1;
			continue;
		}
		const entity = char === ";" && value.slice(0, end).match(ENTITY);
		if (entity) {
			end = entity.index as number;
			continue;
		}
		break;
	}
	return value.slice(0, end);
}

function hrefFor(value: string, bracketed: boolean) {
	if (SCHEME.test(value)) return SAFE_SCHEME.test(value) ? value : undefined;
	if (EMAIL.test(value)) return `mailto:${value}`;
	if (bracketed) return undefined;
	return `https://${value}`;
}

function autolink(value: string): InlineNode[] {
	const nodes: InlineNode[] = [];
	let at = 0;
	AUTOLINK.lastIndex = 0;
	for (let match = AUTOLINK.exec(value); match; match = AUTOLINK.exec(value)) {
		const bracketed = match.groups?.bracketed;
		const text = bracketed ?? trimTrailing(match.groups?.bare as string);
		const href = text ? hrefFor(text, bracketed !== undefined) : undefined;
		if (!href) continue;
		if (match.index > at)
			nodes.push({ type: "text", value: value.slice(at, match.index) });
		nodes.push({
			type: "link",
			href,
			children: [{ type: "text", value: text }],
		});
		at = match.index + text.length + (bracketed === undefined ? 0 : 2);
		AUTOLINK.lastIndex = at;
	}
	if (at < value.length) nodes.push({ type: "text", value: value.slice(at) });
	return nodes;
}

function transform(nodes: InlineNode[]): InlineNode[] {
	const result: InlineNode[] = [];
	for (const node of nodes) {
		if (node.type === "text") result.push(...autolink(node.value));
		else if (node.type === "link") result.push(node);
		else if ("children" in node)
			result.push({ ...node, children: transform(node.children) });
		else result.push(node);
	}
	return result;
}

export function autolinkExtension(): MarkdownExtension {
	return { name: "autolink", transformInline: transform };
}
