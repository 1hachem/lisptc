import {
	Interp,
	prelude,
	runAsync,
	runSync,
	str,
} from "@repo/interpreter/lisp";
import { mcpExtension } from "@repo/mcp-extension";
import { mcpHost } from "@repo/mcp-extension/mcp-host";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { afterAll, describe, expect, it } from "vitest";
import { type MockServer, mockMcpClient } from "./helpers.ts";

function replWith(servers: Record<string, MockServer>): Interp {
	const interp = new Interp({
		extensions: [
			promisesExtension(promisesHost),
			mcpExtension({ ...mcpHost, client: mockMcpClient(servers) }),
		],
	});
	runSync(interp, prelude);
	return interp;
}

async function evalStr(interp: Interp, code: string): Promise<string> {
	return str((await runAsync(interp, code)).value);
}

function loadForm(name: string): string {
	return `(load-mcp :name "${name}" :command "node")`;
}

describe("awaiting an MCP load", () => {
	const interp = replWith({
		afx: { tools: ["echo"], connectDelayMs: 300 },
		slowfx: { tools: ["echo"], connectDelayMs: 2000 },
	});

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("reports :pending before it settles", async () => {
		expect(await evalStr(interp, `(setq j ${loadForm("afx")})`)).toBe(
			"#<promise>",
		);
		expect(await evalStr(interp, "(promise-state j)")).toBe(":pending");
	});

	it("await installs the bindings and returns the tool list", async () => {
		expect(await evalStr(interp, "(await j)")).toContain("afx/echo");
		expect(await evalStr(interp, "(promise-state j)")).toBe(":fulfilled");
	});

	it("the tool works after await", async () => {
		expect(await evalStr(interp, '(afx/echo :message "hi")')).toBe('"hi"');
	});

	it("await is idempotent", async () => {
		expect(await evalStr(interp, "(await j)")).toContain("afx/echo");
	});

	it("rejects an invalid timeout even on a settled promise", async () => {
		await expect(runAsync(interp, "(await j -5)")).rejects.toThrow(
			/invalid await timeout/,
		);
	});

	it("await honors a timeout and leaves the promise awaitable", async () => {
		await evalStr(interp, `(setq slow ${loadForm("slowfx")})`);
		await expect(runAsync(interp, "(await slow 1)")).rejects.toThrow(
			/timed out/,
		);
		expect(await evalStr(interp, "(promise-state slow)")).toBe(":pending");
		expect(await evalStr(interp, "(cancel slow)")).toBe("t");
	});
});

describe("combining MCP loads with the promise combinators", () => {
	const interp = replWith({
		allA: { tools: ["echo"], connectDelayMs: 50 },
		allB: { tools: ["echo"], connectDelayMs: 100 },
		settledOk: { tools: ["echo"], connectDelayMs: 50 },
		gone: { tools: [] },
		anySlow: { tools: ["echo"], connectDelayMs: 600 },
		anyFast: { tools: ["echo"], connectDelayMs: 50 },
		raceSlow: { tools: ["echo"], connectDelayMs: 600 },
		raceFast: { tools: ["echo"], connectDelayMs: 50 },
	});

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("promise-all collects every value in order", async () => {
		const out = await evalStr(
			interp,
			`(await (promise-all (list ${loadForm("allA")} ${loadForm("allB")})))`,
		);
		expect(out).toContain("allA/echo");
		expect(out).toContain("allB/echo");
	});

	it("promise-all-settled keeps the ones that worked", async () => {
		const out = await evalStr(
			interp,
			`(await (promise-all-settled (list ${loadForm("settledOk")} ${loadForm("gone")})))`,
		);
		expect(out).toContain(":fulfilled");
		expect(out).toContain("settledOk/echo");
		expect(out).toContain(":rejected");
		expect(out).toContain("no tools");
	});

	it("promise-any returns the first one to succeed", async () => {
		const out = await evalStr(
			interp,
			`(await (promise-any (list ${loadForm("anySlow")} ${loadForm("anyFast")})))`,
		);
		expect(out).toContain("anyFast/echo");
	});

	it("promise-race returns whichever settles first", async () => {
		const out = await evalStr(
			interp,
			`(await (promise-race (list ${loadForm("raceSlow")} ${loadForm("raceFast")})))`,
		);
		expect(out).toContain("raceFast/echo");
	});
});

describe("reaping settled MCP promises", () => {
	const interp = replWith({
		reap0: { tools: ["echo"] },
		reap1: { tools: ["echo"] },
		reap2: { tools: ["echo"] },
		cachefx: { tools: ["echo"] },
	});

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("drops a settled promise from (promises), and stays flat across cycles", async () => {
		expect(await evalStr(interp, "(length (promises))")).toBe("0");

		for (let i = 0; i < 3; i++) {
			await evalStr(interp, `(setq rj ${loadForm(`reap${i}`)})`);
			expect(await evalStr(interp, "(await rj)")).toContain(`reap${i}/echo`);
			expect(await evalStr(interp, "(length (promises))")).toBe("0");
		}
	});

	it("still resolves to the same value once dropped, as a promise does", async () => {
		await evalStr(interp, `(setq cj ${loadForm("cachefx")})`);
		const first = await evalStr(interp, "(await cj)");
		expect(first).toContain("cachefx/echo");
		expect(await evalStr(interp, "(length (promises))")).toBe("0");
		expect(await evalStr(interp, "(await cj)")).toBe(first);
	});
});
