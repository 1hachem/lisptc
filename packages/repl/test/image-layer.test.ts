import type { Image } from "@repo/interpreter/image";
import { describe, expect, it } from "vitest";
import { layerOver, stack } from "../src/image-layer.ts";

function image(over: Partial<Image> = {}): Image {
	return {
		format: 2,
		objects: [],
		globals: [],
		docs: {},
		sources: {},
		...over,
	};
}

describe("image layers", () => {
	const below = image({
		objects: [{ cell: [1, null] }, { sym: "x" }],
		globals: [[{ s: "a" }, { "#": 0 }]],
		docs: { a: { text: "a" } as never },
		sources: { a: { "#": 0 } },
	});
	const above = image({
		objects: [{ cell: [1, null] }, { sym: "y" }, { sym: "z" }],
		globals: [
			[{ s: "a" }, { "#": 0 }],
			[{ s: "b" }, { "#": 1 }],
		],
		docs: {},
		sources: { a: { "#": 0 }, b: { "#": 2 } },
	});

	it("carries only what changed over the layer below", () => {
		const layer = layerOver(below, above);
		expect(layer.whole).toBe(false);
		expect(layer.objects).toEqual({
			keep: 1,
			tail: [{ sym: "y" }, { sym: "z" }],
		});
		expect(layer.globals.keep).toBe(1);
		expect(layer.docs).toEqual({ set: {}, drop: ["a"] });
		expect(layer.sources).toEqual({ set: { b: { "#": 2 } }, drop: [] });
	});

	it("stacks back to the image it was taken from", () => {
		expect(
			stack([layerOver(undefined, below), layerOver(below, above)]),
		).toEqual(above);
	});

	it("starts whole over nothing or over another format", () => {
		expect(layerOver(undefined, above).whole).toBe(true);
		expect(layerOver(image({ format: 1 }), above).whole).toBe(true);
	});

	it("refuses a stack that does not start whole", () => {
		expect(() => stack([layerOver(below, above)])).toThrow();
	});
});
