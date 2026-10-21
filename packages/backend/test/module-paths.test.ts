import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CONVEX = new URL("../convex/", import.meta.url);
const CONVEX_PATH_COMPONENT = /^[A-Za-z0-9_.]+$/;

describe("the convex directory", () => {
	it("names every file and folder the way a convex push accepts", () => {
		const rejected = readdirSync(CONVEX, { recursive: true, encoding: "utf8" })
			.flatMap((path) => path.split("/"))
			.filter((part) => !CONVEX_PATH_COMPONENT.test(part));
		expect([...new Set(rejected)]).toEqual([]);
	});
});
