import React from "react";
import { combineTransforms } from "./transform";

export type SvgxProps = React.SVGProps<SVGElement>;
export type Svgx = React.ReactElement<SvgxProps>;

export function isValidSvgx(element: unknown): element is Svgx {
	return React.isValidElement(element);
}

export function isComponentElement(element: Svgx): boolean {
	return typeof element.type !== "string" && element.type !== React.Fragment;
}

export function assertNoDragologyKeyOnComponent(element: Svgx): void {
	if (isComponentElement(element) && element.props.dragologyKey !== undefined) {
		throw new Error(
			`<${elementName(element)}> has a dragologyKey, which only works on ` +
				`intrinsic elements. Wrap it in a <g dragologyKey=…> instead.`,
		);
	}
}

export function assertForeignObjectHoldsComponents(element: Svgx): void {
	if (element.type !== "foreignObject") return;
	for (const child of React.Children.toArray(element.props.children)) {
		if (React.isValidElement(child) && isComponentElement(child as Svgx)) {
			continue;
		}
		const what = React.isValidElement(child)
			? `<${elementName(child as Svgx)}>`
			: JSON.stringify(child);
		throw new Error(
			`<foreignObject> contains ${what}, but it may only contain ` +
				`component elements. Move the HTML into a component.`,
		);
	}
}

export function elementName(element: Svgx): string {
	const type = element.type as any;
	return typeof type === "string" ? type : (type.displayName ?? type.name);
}

export function shouldRecurseIntoChildren(element: Svgx): boolean {
	return (
		!isComponentElement(element) &&
		element.type !== "defs" &&
		!element.props.dragologyOpaque
	);
}

type ChildNode = Exclude<React.ReactNode, boolean | null | undefined>;

export function childrenToArray(children: React.ReactNode): ChildNode[] {
	const out: ChildNode[] = [];
	const visit = (node: React.ReactNode, prefix: string) => {
		if (Array.isArray(node)) {
			node.forEach((child, i) =>
				visit(child, prefix === "" ? `.${i}` : `${prefix}:${i}`),
			);
		} else if (node == null || typeof node === "boolean") {
			return;
		} else if (React.isValidElement(node) && node.key == null) {
			out.push(React.cloneElement(node, { key: prefix || ".0" }));
		} else if (React.isValidElement(node) && !node.key!.startsWith(".")) {
			throw new Error(
				`<${elementName(node as Svgx)}> has a key prop (${node.key}). ` +
					`Draggables match elements by id or dragologyKey, not key.`,
			);
		} else {
			out.push(node as ChildNode);
		}
	};
	visit(children, "");
	return out;
}

export function updateElement(
	element: Svgx,
	childFn?: (el: Svgx, idx: number) => Svgx | null,
	newProps?: SvgxProps,
): Svgx {
	const { children } = element.props;

	if (childFn && children && shouldRecurseIntoChildren(element)) {
		const childrenArray = childrenToArray(children);
		let someChildChanged = false;
		const newChildren = childrenArray.map((child, index) => {
			if (React.isValidElement(child)) {
				const updated = childFn(child as Svgx, index);
				if (updated !== child) someChildChanged = true;
				return updated;
			} else {
				return child;
			}
		});
		if (someChildChanged) {
			newProps = { ...newProps, children: newChildren };
		}
	}

	if (!newProps) return element;

	const merged = { ...element.props, ...newProps };
	const cleaned: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(merged)) {
		if (v !== undefined) cleaned[k] = v;
	}

	if (element.key != null) cleaned.key = element.key;
	return React.createElement(element.type, cleaned);
}

export type FindElementResult = {
	element: Svgx;
	accumulatedTransform: string;
	ancestors: Svgx[];
};

export function findElement(
	element: Svgx,
	predicate: (el: Svgx) => boolean,
	accumulatedTransform: string = "",
	ancestors: Svgx[] = [],
): FindElementResult | null {
	const elementTransform = (element.props as any).transform || "";
	const newAccumulatedTransform = combineTransforms(
		accumulatedTransform,
		elementTransform,
	);

	if (predicate(element)) {
		return {
			element,
			accumulatedTransform: newAccumulatedTransform,
			ancestors,
		};
	}

	const childAncestors = [...ancestors, element];

	if (shouldRecurseIntoChildren(element)) {
		const children = React.Children.toArray(element.props.children);
		for (const child of children) {
			if (React.isValidElement(child)) {
				const found = findElement(
					child as Svgx,
					predicate,
					newAccumulatedTransform,
					childAncestors,
				);
				if (found) return found;
			}
		}
	}

	return null;
}

export function updatePropsDownTree(
	element: Svgx,
	mapFn: (el: Svgx) => SvgxProps | undefined,
): Svgx {
	return updateElement(
		element,
		(child) => updatePropsDownTree(child, mapFn),
		mapFn(element),
	);
}
