import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isComplete } from "../src/cli.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

function typed(input: string): Promise<string[]> {
	const child = spawn(
		process.execPath,
		["--no-warnings", "--experimental-transform-types", CLI],
		{ stdio: ["pipe", "pipe", "ignore"] },
	);
	let out = "";
	child.stdout.on("data", (chunk: Buffer) => {
		out += chunk.toString();
	});
	child.stdin.end(input);
	return new Promise((resolve) =>
		child.on("close", () => resolve(out.match(/-?\d+/g) ?? [])),
	);
}

describe("isComplete (attach-mode line buffering)", () => {
	it("is false for the opening line of a multi-line form", () => {
		expect(isComplete("(try\n")).toBe(false);
	});

	it("is false while a nested form is still open", () => {
		expect(isComplete("(try\n  (+ 1 2)\n")).toBe(false);
	});
});

describe("the prompt, as a user types at it", () => {
	it("prints each form's value once it is closed, however many lines it spans", async () => {
		expect(await typed("(+ 1 2)\n(let ((x 40))\n  (+ x 2))\n")).toEqual([
			"3",
			"42",
		]);
	}, 60_000);

	it("does not hold back the next line after a stray close paren", async () => {
		expect(await typed(")\n(+ 1 1)\n")).toEqual(["2"]);
	}, 60_000);
});
