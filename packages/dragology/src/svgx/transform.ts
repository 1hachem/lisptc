import { createElement } from "react";
import { ErrorWithJSX } from "../ErrorBoundary";
import { lerp, Vec2, type Vec2able } from "../math/vec2";
import { assert } from "../utils/assert";

export type Transform =
	| { type: "translate"; x: number; y: number }
	| { type: "rotate"; degrees: number; cx: number; cy: number }
	| { type: "scale"; x: number; y: number };

export function parseTransform(str: string | null | undefined): Transform[] {
	if (!str || str.trim() === "") return [];

	const transforms: Transform[] = [];

	const regex = /(\w+)\s*\(([^)]+)\)/g;
	let match;

	while ((match = regex.exec(str)) !== null) {
		const type = match[1];
		const args = match[2].split(/[\s,]+/).map((s) => parseFloat(s.trim()));

		switch (type) {
			case "translate":
				transforms.push({
					type: "translate",
					x: args[0] || 0,
					y: args[1] || 0,
				});
				break;
			case "rotate":
				transforms.push({
					type: "rotate",
					degrees: args[0] || 0,
					cx: args[1] || 0,
					cy: args[2] || 0,
				});
				break;
			case "scale":
				transforms.push({
					type: "scale",
					x: args[0] ?? 1,
					y: args[1] ?? args[0] ?? 1,
				});
				break;
		}
	}

	return transforms;
}

export type TransformsLike = Transform[] | string | null | undefined;

const resolveTransformsLike = (t: TransformsLike) =>
	Array.isArray(t) ? t : parseTransform(t);

export function localToGlobal(
	transformsLike: TransformsLike,
	able: Vec2able,
): Vec2 {
	const transforms = resolveTransformsLike(transformsLike);
	let point = Vec2(able);
	for (const t of transforms.slice().reverse()) {
		switch (t.type) {
			case "translate":
				point = point.add([t.x, t.y]);
				break;
			case "rotate":
				point = point
					.sub([t.cx ?? 0, t.cy ?? 0])
					.rotateDeg(t.degrees)
					.add([t.cx ?? 0, t.cy ?? 0]);
				break;
			case "scale":
				point = point.scale([t.x, t.y]);
				break;
		}
	}
	return point;
}

export function globalToLocal(
	transformsLike: TransformsLike,
	able: Vec2able,
): Vec2 {
	const transforms = resolveTransformsLike(transformsLike);
	let point = Vec2(able);
	for (const t of transforms) {
		switch (t.type) {
			case "translate":
				point = point.sub([t.x, t.y]);
				break;
			case "rotate":
				point = point
					.sub([t.cx ?? 0, t.cy ?? 0])
					.rotateDeg(-t.degrees)
					.add([t.cx ?? 0, t.cy ?? 0]);
				break;
			case "scale":
				point = point.scale([1 / t.x, 1 / t.y]);
				break;
		}
	}
	return point;
}

export function combineTransforms(t1: string, t2: string): string {
	if (!t1 && !t2) return "";
	if (!t1) return t2;
	if (!t2) return t1;
	return t1 + " " + t2;
}

function serializeTransform(transforms: Transform[]): string {
	return transforms
		.map((t) => {
			switch (t.type) {
				case "translate":
					return `translate(${t.x}, ${t.y})`;
				case "rotate":
					return `rotate(${t.degrees}, ${t.cx}, ${t.cy})`;
				case "scale":
					return t.x === t.y ? `scale(${t.x})` : `scale(${t.x}, ${t.y})`;
			}
		})
		.join(" ");
}

function lerpTransforms(
	a: Transform[],
	b: Transform[],
	t: number,
): Transform[] {
	a = collapseTranslations(a);
	b = collapseTranslations(b);

	if (a.length !== b.length) {
		throw new ErrorWithJSX(
			`Cannot lerp transforms with different lengths: ${a.length} vs ${b.length}`,
			[
				a.map((t) => [serializeTransform([t]), createElement("br")]),
				"vs",
				createElement("br"),
				b.map((t) => [serializeTransform([t]), createElement("br")]),
			],
		);
	}

	const result: Transform[] = [];

	for (let i = 0; i < a.length; i++) {
		const ta = a[i];
		const tb = b[i];

		if (ta.type !== tb.type) {
			throw new ErrorWithJSX(
				`Cannot lerp transforms with different types at index ${i}: ${ta.type} vs ${tb.type}`,
				[
					`a: ${serializeTransform(a)}`,
					createElement("br"),
					`b: ${serializeTransform(b)}`,
				],
			);
		}

		switch (ta.type) {
			case "translate":
				assert(tb.type === "translate");
				result.push({
					type: "translate",
					x: lerp(ta.x, tb.x, t),
					y: lerp(ta.y, tb.y, t),
				});
				break;
			case "rotate": {
				assert(tb.type === "rotate");
				result.push({
					type: "rotate",
					degrees: lerpDegrees(ta.degrees, tb.degrees, t),
					cx: lerp(ta.cx, tb.cx, t),
					cy: lerp(ta.cy, tb.cy, t),
				});
				break;
			}
			case "scale":
				assert(tb.type === "scale");
				result.push({
					type: "scale",
					x: lerp(ta.x, tb.x, t),
					y: lerp(ta.y, tb.y, t),
				});
				break;
		}
	}

	return result;
}

function lerpDegrees(a: number, b: number, t: number): number {
	const delta = ((((b - a) % 360) + 540) % 360) - 180;
	return a + delta * t;
}

function collapseTranslations(transforms: Transform[]): Transform[] {
	const result: Transform[] = [];
	for (const t of transforms) {
		const prev = result[result.length - 1];
		if (t.type === "translate" && prev?.type === "translate") {
			result[result.length - 1] = {
				type: "translate",
				x: prev.x + t.x,
				y: prev.y + t.y,
			};
		} else {
			result.push(t);
		}
	}
	return result;
}

export function lerpTransformString(a: string, b: string, t: number): string {
	if (!a && !b) return "";

	const transformsA = parseTransform(a);
	const transformsB = parseTransform(b);

	if (
		transformsA.length === 0 &&
		transformsB.every((t) => t.type === "translate")
	) {
		const lerpedTransforms = lerpTransforms(
			[{ type: "translate", x: 0, y: 0 }],
			transformsB,
			t,
		);
		return serializeTransform(lerpedTransforms);
	}
	if (
		transformsB.length === 0 &&
		transformsA.every((t) => t.type === "translate")
	) {
		const lerpedTransforms = lerpTransforms(
			transformsA,
			[{ type: "translate", x: 0, y: 0 }],
			t,
		);
		return serializeTransform(lerpedTransforms);
	}

	const aHasScale = transformsA.some((t) => t.type === "scale");
	const bHasScale = transformsB.some((t) => t.type === "scale");

	if (aHasScale || bHasScale) {
		let normA = collapseTranslations(transformsA);
		let normB = collapseTranslations(transformsB);

		const aHasTranslate = normA.some((t) => t.type === "translate");
		const bHasTranslate = normB.some((t) => t.type === "translate");
		if (aHasTranslate && !bHasTranslate) {
			normB = [{ type: "translate", x: 0, y: 0 }, ...normB];
		} else if (bHasTranslate && !aHasTranslate) {
			normA = [{ type: "translate", x: 0, y: 0 }, ...normA];
		}

		if (!aHasScale) {
			normA = [...normA, { type: "scale", x: 1, y: 1 }];
		}
		if (!bHasScale) {
			normB = [...normB, { type: "scale", x: 1, y: 1 }];
		}

		return serializeTransform(lerpTransforms(normA, normB, t));
	}

	if (!a) return b;
	if (!b) return a;

	const lerpedTransforms = lerpTransforms(transformsA, transformsB, t);

	return serializeTransform(lerpedTransforms);
}
