import { Interp } from "@repo/interpreter/lisp";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";

const PROMPT = new Interp({
	extensions: [mcpExtension(mcpHost)],
}).systemPrompt();

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
			/load-mcp async: returns promise\s+at once, NOT blocking/,
		);
		expect(PROMPT).toMatch(
			/\(promise-state p\) checks progress without blocking:\s+:pending, :fulfilled or :rejected/,
		);
	});

	it("teaches desktop-connected-p", () => {
		expect(PROMPT).toMatch(
			/\(desktop-connected-p\) : t if desktop app connected as of this step, else nil\./,
		);
	});

	it("teaches :local runs a toolkit server's own setup on the user's machine", () => {
		expect(PROMPT).toMatch(/Row ends :also-local/);
		expect(PROMPT).toMatch(/\(load-mcp "acme" :local t\)/);
	});

	it("teaches the predefined local servers and the local/<name> gate", () => {
		expect(PROMPT).toMatch(
			/\(load-mcp "local-files"\) , \(load-mcp "local-git"\)/,
		);
		expect(PROMPT).toMatch(/\(permission\/allow local\/\*\)/);
		expect(PROMPT).toMatch(/desktop app not open or user denied/);
		expect(PROMPT).toMatch(
			/Listed only while desktop app connected\. Row ends :local/,
		);
		expect(PROMPT).toMatch(
			/"desktop app connected: local servers now\s+loadable: …"/,
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
		expect(PROMPT).not.toMatch(/:command "/);
	});

	it("tells the model :command is not supported", () => {
		expect(PROMPT).toMatch(/:command , :args , :env NOT supported/);
	});

	it("shows how to load several servers concurrently", () => {
		expect(PROMPT).toMatch(/promise-all-settled \(list \(load-mcp/);
	});
});
