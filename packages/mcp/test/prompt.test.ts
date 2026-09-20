import { Interp } from "@repo/interpreter/lisp";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";

const PROMPT = new Interp({ extensions: [mcpExtension()] }).systemPrompt();

const names = (name: string): RegExp => new RegExp(`\\b${name}\\b`);

describe("the prompt the extension carries", () => {
	const MCP_BUILTINS = [
		"load-mcp",
		"unload-mcp",
		"list-mcps",
		"list-toolkit",
		"list-tools",
		"search-tools",
		"search-mcps",
		"mcp-shutdown",
		"mcp-authorize",
		"login",
		"logout",
	];

	it.each(MCP_BUILTINS)("names %s", (name) => {
		expect(PROMPT).toMatch(names(name));
	});

	it("says load-mcp is async: it returns a promise and does not block", () => {
		expect(PROMPT).toMatch(
			/load-mcp is asynchronous: it returns a promise immediately and does NOT block/,
		);
		expect(PROMPT).toMatch(
			/\(promise-state p\) checks progress \(:pending\/:fulfilled\/:rejected\)/,
		);
	});

	it("teaches the <server>/<tool> keyword calling convention", () => {
		expect(PROMPT).toMatch(
			/global named <server>\/<tool>, called with keyword args/,
		);
		expect(PROMPT).toMatch(/\(acme\/get_widget :id "42"\)/);
	});

	it.each([
		"playwright",
		"fs/",
		"linear",
		"posthog",
	])("names no real toolkit server in its examples (%s)", (name) => {
		expect(PROMPT).not.toContain(name);
	});

	it("says the server and tool names have to be discovered, not invented", () => {
		expect(PROMPT).toMatch(
			/You are not told which servers exist or what they are called/,
		);
		expect(PROMPT).toMatch(
			/Never invent a server or tool name — read it out of one of those results/,
		);
		expect(PROMPT).toMatch(
			/start from\s+search-mcps and let each step tell you the next name/,
		);
	});

	it("shows how to load a predefined server and an ad-hoc one", () => {
		expect(PROMPT).toMatch(/\(await \(load-mcp "acme"\)\)/);
		expect(PROMPT).toMatch(/:url "https:\/\/\.\.\."/);
		expect(PROMPT).toMatch(/:command "npx"/);
	});

	it("shows how to load several servers concurrently", () => {
		expect(PROMPT).toMatch(/promise-all-settled \(list \(load-mcp/);
	});
});
