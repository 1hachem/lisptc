import { Cell } from "@repo/interpreter/objects";
import { Reader } from "@repo/interpreter/reader";
import { describe, expect, it } from "vitest";
import { parseRules } from "../src/rules.ts";
import { session } from "./helpers.ts";

const CONFIG = `
Anything outside a form is prose, so a config can explain itself.

(permission/default ask)
(permission/allow + - * car cdr list quote str/*)
(permission/deny eval :reason "no code built from strings")
(permission/ask memory/forget-all)

(permission/server github
  (allow list_* get_*)
  (ask create_*)
  (deny delete_* :reason "nothing destructive on github")
  (hide admin_* *_token))

(permission/deny-server shell :reason "no shell access")
(permission/hide-server internal-metrics)
(permission/ask github/list_secrets)
`;

function form(source: string): Cell {
	const reader = new Reader();
	reader.push(source);
	const read = reader.read();
	if (!(read instanceof Cell)) throw new Error(`not a form: ${source}`);
	return read;
}

async function check(
	source: string,
	name: string,
): Promise<string | undefined> {
	return (await session(source).step(`(permission/check '${name})`)).value;
}

describe("a permissions config", () => {
	const rules = parseRules(CONFIG);

	it.each([
		["car", "allow"],
		["*", "allow"],
		["str/upper", "allow"],
		["eval", "deny"],
		["memory/forget-all", "ask"],
		["cons", "ask"],
		["github/list_issues", "allow"],
		["github/create_issue", "ask"],
		["github/delete_repo", "deny"],
		["github/list_secrets", "ask"],
		["github/admin_users", "deny"],
	])("checks %s as %s", async (name, verdict) => {
		expect(await check(CONFIG, name)).toBe(verdict);
	});

	it("refuses a call with the reason of the rule that won", async () => {
		const s = session(
			'(permission/ask string-* :reason "strings are reviewed") (permission/deny string-upcase :reason "shouting is off")',
		);
		const run = await s.step('(string-upcase "a")');
		expect(run.failed).toBe(true);
		expect(run.report).toContain("shouting is off");
		expect(run.report).not.toContain("strings are reviewed");
	});

	it("reads a bare * as the multiplication form, not as everything", () => {
		expect(
			parseRules("(permission/default deny) (permission/allow *)").decide("car")
				.verdict,
		).toBe("deny");
	});

	it("hides a tool from the mcp policy and denies it, whatever an allow says", async () => {
		const hiding = "(permission/server gh (allow *) (hide admin_*))";
		const { rules: policy } = session(hiding).extension;
		expect(policy.tool("gh", "admin_users")).toBe(false);
		expect(policy.tool("gh", "list")).toBe(true);
		expect(await check(hiding, "gh/admin_users")).toBe("deny");
	});

	it("shows only what an only form names, hiding the rest of that server", async () => {
		const playwright = "(permission/server playwright (only browser_navigate))";
		const { rules: policy } = session(playwright).extension;
		expect(policy.tool("playwright", "browser_navigate")).toBe(true);
		expect(policy.tool("playwright", "browser_navigate_back")).toBe(false);
		expect(policy.tool("playwright", "browser_click")).toBe(false);
		expect(policy.tool("github", "list_issues")).toBe(true);
		expect(await check(playwright, "playwright/browser_click")).toBe("deny");
		expect(await check(playwright, "playwright/browser_navigate")).toBe(
			"allow",
		);
	});

	it("still lets a verdict govern a tool an only form shows", async () => {
		expect(
			await check(
				"(permission/server playwright (only browser_navigate) (ask browser_navigate))",
				"playwright/browser_navigate",
			),
		).toBe("ask");
	});

	it("answers for whole servers", () => {
		expect(rules.server("shell")).toEqual({
			access: "denied",
			reason: "no shell access",
		});
		expect(rules.server("internal-metrics")).toEqual({ access: "hidden" });
		expect(rules.server("github")).toEqual({ access: "open" });
	});

	it("never lets a deny-server bring a hidden server back into view", () => {
		const { rules: policy } = session(
			"(permission/hide-server x) (permission/deny-server x)",
		).extension;
		expect(policy.server("x")).toEqual({ access: "hidden" });
	});

	it("allows everything when the config is empty", async () => {
		const s = session("");
		expect((await s.step("(permission/check 'eval)")).value).toBe("allow");
		expect((await s.step('(string-upcase "a")')).value).toBe('"A"');
	});

	it.each([
		["(permit car)", "unknown permissions form"],
		["(deny car)", "unknown permissions form"],
		["(permission/allow)", "names nothing"],
		['(permission/deny eval :because "x")', "bad permissions option"],
		["(permission/default maybe)", "a verdict is allow, deny or ask"],
		["(permission/server gh)", "names no rules"],
		["(permission/server gh (hide-server x))", "unknown server rule"],
		["(permission/allow car", "ends inside a form"],
	])("refuses the config %s", (source, message) => {
		expect(() => session(source)).toThrow(message);
	});
});

describe("changing a config one form at a time", () => {
	const base = parseRules(
		"(permission/default ask) (permission/server pw (only nav))",
	);

	it("refuses a form that does not parse, and leaves the config alone", () => {
		expect(() => base.with(form("(permission/permit eval)"))).toThrow(
			"unknown permissions form",
		);
	});
});
