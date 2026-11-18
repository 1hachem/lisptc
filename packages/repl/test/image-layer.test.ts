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

	it("refuses a stack that does not start whole", () => {
		expect(() => stack([layerOver(below, above)])).toThrow();
	});
});
