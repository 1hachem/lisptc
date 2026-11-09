import { cloneElement, Fragment } from "react";
import { ErrorWithJSX } from "../ErrorBoundary";
import { assert } from "../utils/assert";
import { objectKeys } from "../utils/js";
import {
	type FindElementResult,
	isComponentElement,
	type Svgx,
	type SvgxProps,
	updateElement,
	updatePropsDownTree,
} from ".";
import { findByPath } from "./path";
import { combineTransforms } from "./transform";

export type Layer = {
	element: Svgx;
	stackingPath: number[];
};

export type LayeredSvgx = {
	byId: Map<string, Layer>;
	descendents: Map<string, Set<string>> | null;
};

export function layerSvg(element: Svgx): LayeredSvgx {
	let byId = new Map<string, Layer>();
	const descendents = new Map<string, Set<string>>();
	const rootWithExtractedRemoved = extractIdNodes(
		element,
		byId,
		descendents,
		null,
		"",
		1,
		[],
	);
	if (rootWithExtractedRemoved) {
		byId = new Map([
			["", { element: rootWithExtractedRemoved, stackingPath: [] }],
			...byId,
		]);
	}
	return { byId, descendents };
}

function parseAbsoluteZIndex(value: string): number {
	assert(
		/^\/(-?\d+)$/.test(value),
		`Invalid absolute dragologyZIndex "${value}". Expected format: "/<integer>" (e.g. "/5", "/-3").`,
	);
	return parseInt(value.slice(1), 10);
}

function extractIdNodes(
	element: Svgx,
	byId: Map<string, Layer>,
	descendents: Map<string, Set<string>>,
	ancestorId: string | null,
	accumulatedTransform: string,
	accumulatedOpacity: number,
	stackingPath: number[],
): Svgx | null {
	const props = element.props as any;

	if (props["dragologyZIndex"] !== undefined && !props.id) {
		throw new Error(
			`dragologyZIndex can only be set on elements with an id attribute. Found dragologyZIndex="${props["dragologyZIndex"]}" on <${element.type}> without id.`,
		);
	}

	const currentId = isComponentElement(element) ? undefined : props.id;
	const newAncestorId = currentId || ancestorId;
	const elementTransform = props.transform || "";
	const newAccumulatedTransform = combineTransforms(
		accumulatedTransform,
		elementTransform,
	);
	const elementOpacity =
		props.opacity !== undefined ? Number(props.opacity) : 1;
	const newAccumulatedOpacity = accumulatedOpacity * elementOpacity;

	let newStackingPath = stackingPath;
	if (currentId) {
		const zIndex = props["dragologyZIndex"];
		if (typeof zIndex === "string") {
			newStackingPath = [parseAbsoluteZIndex(zIndex)];
		} else {
			newStackingPath = [...stackingPath, zIndex || 0];
		}
	}

	const newElement = updateElement(element, (child) =>
		extractIdNodes(
			child,
			byId,
			descendents,
			newAncestorId,
			newAccumulatedTransform,
			newAccumulatedOpacity,
			newStackingPath,
		),
	);

	if (currentId) {
		assert(
			!byId.has(currentId),
			`Duplicate id "${currentId}" found in SVG tree. Each element must have a unique id.`,
		);

		if (ancestorId) {
			if (!descendents.has(ancestorId)) {
				descendents.set(ancestorId, new Set());
			}
			descendents.get(ancestorId)!.add(currentId);

			if (descendents.has(currentId)) {
				for (const desc of descendents.get(currentId)!) {
					descendents.get(ancestorId)!.add(desc);
				}
			}
		}

		const layerElement = cloneElement(newElement, {
			key: currentId,
			transform: newAccumulatedTransform || undefined,
			opacity: newAccumulatedOpacity !== 1 ? newAccumulatedOpacity : undefined,
		});

		byId.set(currentId, {
			element: layerElement,
			stackingPath: newStackingPath,
		});
		return null;
	} else {
		return newElement;
	}
}

function compareStackingPaths(a: number[], b: number[]): number {
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		if (a[i] !== b[i]) return a[i] - b[i];
	}
	if (a.length === b.length) return 0;
	if (a.length > b.length) {
		return a[len] >= 0 ? 1 : -1;
	} else {
		return b[len] >= 0 ? -1 : 1;
	}
}

export function drawLayered(layered: LayeredSvgx): Svgx {
	return (
		<>
			{Array.from(layered.byId.entries())
				.sort(([_keyA, layerA], [_keyB, layerB]) =>
					compareStackingPaths(layerA.stackingPath, layerB.stackingPath),
				)
				.map(([key, layer]) => (
					<Fragment key={key}>
						{updatePropsDownTree(layer.element, (el) => {
							assert(
								el.type !== Fragment,
								"Please use <g> rather than <Fragment> / <> in draggables.",
							);

							const newProps: SvgxProps = {};
							for (const propName of objectKeys(el.props)) {
								if (propName.startsWith("dragology")) {
									newProps[propName] = undefined;
								}
							}
							return newProps;
						})}
					</Fragment>
				))}
		</>
	);
}

export function layeredExtract(
	layered: LayeredSvgx,
	id: string,
): { remaining: LayeredSvgx; extracted: LayeredSvgx } {
	assert(layered.descendents !== null, "layered.descendents is null");
	if (!layered.byId.has(id)) {
		throw new ErrorWithJSX(
			`Layered SVG does not contain id "${id}"`,
			<p>
				Available ids: <code>{[...layered.byId.keys()].join(", ")}</code>
			</p>,
		);
	}

	const extractedIds = new Set([id]);
	if (layered.descendents.has(id)) {
		for (const descId of layered.descendents.get(id)!) {
			extractedIds.add(descId);
		}
	}

	const extractedById = new Map<string, Layer>();
	const remainingById = new Map<string, Layer>();
	for (const [key, value] of layered.byId.entries()) {
		if (extractedIds.has(key)) {
			extractedById.set(key, value);
		} else {
			remainingById.set(key, value);
		}
	}

	const extractedDescendents = new Map<string, Set<string>>();
	const remainingDescendents = new Map<string, Set<string>>();

	for (const [ancestorId, descIds] of layered.descendents.entries()) {
		const isAncestorExtracted = extractedIds.has(ancestorId);

		const filteredDescs = new Set<string>();
		for (const descId of descIds) {
			const isDescExtracted = extractedIds.has(descId);
			if (isAncestorExtracted === isDescExtracted) {
				filteredDescs.add(descId);
			}
		}

		if (filteredDescs.size > 0) {
			if (isAncestorExtracted) {
				extractedDescendents.set(ancestorId, filteredDescs);
			} else {
				remainingDescendents.set(ancestorId, filteredDescs);
			}
		}
	}

	return {
		remaining: { byId: remainingById, descendents: remainingDescendents },
		extracted: { byId: extractedById, descendents: extractedDescendents },
	};
}

export function layeredMerge(h1: LayeredSvgx, h2: LayeredSvgx): LayeredSvgx {
	const mergedById = new Map<string, Layer>(h1.byId);
	for (const [key, value] of h2.byId.entries()) {
		assert(
			!mergedById.has(key),
			`Cannot merge LayeredSvgx: duplicate id "${key}" found`,
		);
		mergedById.set(key, value);
	}
	return { byId: mergedById, descendents: null };
}

export function layeredTransform(
	layered: LayeredSvgx,
	transform: string,
): LayeredSvgx {
	const transformedById = new Map<string, Layer>();
	for (const [key, layer] of layered.byId.entries()) {
		const props = layer.element.props as any;
		const elementTransform = props.transform || "";
		const newTransform = combineTransforms(transform, elementTransform);
		const transformedElement = cloneElement(layer.element, {
			transform: newTransform || undefined,
		});
		transformedById.set(key, { ...layer, element: transformedElement });
	}
	return { byId: transformedById, descendents: layered.descendents };
}

export function layeredPrefixIds(
	layered: LayeredSvgx,
	prefix: string,
): LayeredSvgx {
	const prefixedById = new Map<string, Layer>();
	for (const [key, layer] of layered.byId.entries()) {
		const newId = prefix + key;
		const prefixedElement = cloneElement(layer.element, {
			id: newId,
			["data-path" as any]: newId + "/",
		});
		prefixedById.set(newId, { ...layer, element: prefixedElement });
	}
	return { byId: prefixedById, descendents: null };
}

export function layeredShiftZIndices(
	layered: LayeredSvgx,
	shift: number,
): LayeredSvgx {
	const shiftedById = new Map<string, Layer>();
	for (const [key, layer] of layered.byId.entries()) {
		shiftedById.set(key, {
			...layer,
			stackingPath: [shift, ...layer.stackingPath],
		});
	}
	return { ...layered, byId: shiftedById };
}

export function layeredSetAttributes(
	layered: LayeredSvgx,
	attrs: Partial<SvgxProps>,
): LayeredSvgx {
	const newById = new Map<string, Layer>();
	for (const [key, layer] of layered.byId.entries()) {
		newById.set(key, { ...layer, element: cloneElement(layer.element, attrs) });
	}
	return { ...layered, byId: newById };
}

export function findByPathInLayered(
	path: string,
	layered: LayeredSvgx,
): FindElementResult | null {
	for (const layer of layered.byId.values()) {
		const found = findByPath(path, layer.element);
		if (found) return found;
	}
	return null;
}
