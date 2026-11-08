import { EvalException } from "@repo/interpreter/errors";
import { Cell, type List } from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import { catalog, type PropsOf, type Tag } from "@repo/ui-catalog";
import type { UiNode, UiValue } from "./view.ts";

export class UiElement implements UiNode {
	constructor(
		readonly tag: string,
		readonly props: Record<string, UiValue>,
		readonly children: UiNode[] = [],
	) {}

	toString(): string {
		return `#<ui:${this.tag}>`;
	}
}

export type Draft<T extends Tag> = {
	[K in keyof PropsOf<T>]?: PropsOf<T>[K] | undefined;
};

export function element<T extends Tag>(
	tag: T,
	draft: Draft<T>,
	children: UiNode[] = [],
): UiElement {
	const given = Object.fromEntries(
		Object.entries(draft).filter(([, value]) => value !== undefined),
	);
	const parsed = catalog[tag].props.safeParse(given);
	if (!parsed.success) {
		const [issue] = parsed.error.issues;
		const at = issue?.path[0];
		throw new EvalException(
			issue?.message ?? `bad props for ui/${tag}`,
			at === undefined ? given : given[String(at)],
		);
	}
	if (!catalog[tag].children && children.length > 0)
		throw new EvalException(`ui/${tag} takes no children`, tag);
	return new UiElement(tag, parsed.data as Record<string, UiValue>, children);
}

export function listElements(x: unknown): unknown[] | undefined {
	if (x === null) return [];
	if (!(x instanceof Cell)) return undefined;
	const out: unknown[] = [];
	for (let p: unknown = x; p instanceof Cell; p = p.cdr) out.push(p.car);
	return out;
}

export function printed(x: unknown): string {
	return typeof x === "string" ? x : str(x, false);
}

export function textOf(x: unknown): UiElement {
	return element("text", { text: printed(x) });
}

export function childNodes(values: List): UiNode[] {
	const out: UiNode[] = [];
	for (const child of listElements(values) ?? []) {
		if (child instanceof UiElement) out.push(child);
		else if (typeof child === "string") out.push(textOf(child));
		else if (child !== null)
			throw new EvalException("ui element expected as a child", child);
	}
	return out;
}

export function nodeToJson(node: UiNode): UiValue {
	return {
		tag: node.tag,
		props: node.props,
		children: node.children.map(nodeToJson),
	};
}

export function toJson(x: unknown): UiValue {
	if (x === null || x === undefined) return null;
	if (x === true) return true;
	if (typeof x === "number") return x;
	if (typeof x === "bigint") return Number(x);
	if (typeof x === "string") return x;
	if (x instanceof UiElement) return nodeToJson(x);
	const items = listElements(x);
	if (items !== undefined) {
		if (
			items.length > 0 &&
			items.every((i) => i instanceof Cell && typeof i.car === "string")
		) {
			const out: Record<string, UiValue> = {};
			for (const pair of items as Cell[])
				out[pair.car as string] = toJson(pair.cdr);
			return out;
		}
		return items.map(toJson);
	}
	return str(x, false);
}
