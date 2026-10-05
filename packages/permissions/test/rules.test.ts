import { Cell } from "@repo/interpreter/objects";
import { Reader } from "@repo/interpreter/reader";
import { describe, expect, it } from "vitest";
import { parseRules } from "../src/rules.ts";

const CONFIG = `
Anything outside a form is prose, so a config can explain itself.

(permission/default ask)
(permission/allow + - * car cdr list str/*)
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
	])("decides %s as %s", (name, verdict) => {
		expect(rules.decide(name).verdict).toBe(verdict);
	});

	it("carries the reason of the rule that won", () => {
		expect(rules.decide("github/delete_repo").reason).toBe(
			"nothing destructive on github",
		);
	});

	it("reads a bare * as the multiplication form, not as everything", () => {
		expect(
			parseRules("(permission/default deny) (permission/allow *)").decide("car")
				.verdict,
		).toBe("deny");
	});

	it("hides a tool, whatever an allow says", () => {
		const hiding = parseRules(
			"(permission/server gh (allow *) (hide admin_*))",
		);
		expect(hiding.tool("gh", "admin_users")).toBe(false);
		expect(hiding.tool("gh", "list")).toBe(true);
		expect(hiding.decide("gh/admin_users").verdict).toBe("deny");
	});

	it("shows only what an only form names, hiding the rest of that server", () => {
		const playwright = parseRules(
			"(permission/server playwright (only browser_navigate))",
		);
		expect(playwright.tool("playwright", "browser_navigate")).toBe(true);
		expect(playwright.tool("playwright", "browser_navigate_back")).toBe(false);
		expect(playwright.tool("playwright", "browser_click")).toBe(false);
		expect(playwright.decide("playwright/browser_click").verdict).toBe("deny");
		expect(playwright.decide("playwright/browser_navigate").verdict).toBe(
			"allow",
		);
		expect(playwright.tool("github", "list_issues")).toBe(true);
	});

	it("still lets a verdict govern a tool an only form shows", () => {
		const asked = parseRules(
			"(permission/server playwright (only browser_navigate) (ask browser_navigate))",
		);
		expect(asked.decide("playwright/browser_navigate").verdict).toBe("ask");
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
		const both = parseRules(
			"(permission/hide-server x) (permission/deny-server x)",
		);
		expect(both.server("x")).toEqual({ access: "hidden" });
	});

	it("allows everything when the config is empty", () => {
		expect(parseRules("").decide("eval").verdict).toBe("allow");
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
	])("refuses %s", (source, message) => {
		expect(() => parseRules(source)).toThrow(message);
	});
});

describe("changing a config one form at a time", () => {
	const base = parseRules(
		"(permission/default ask) (permission/server pw (only nav))",
	);

	it("names only what a rule names, never the default", () => {
		const named = parseRules(
			"(permission/default allow) (permission/deny permission/delete) (permission/allow permission/*)",
		);
		expect(named.named("permission/delete")?.verdict).toBe("deny");
		expect(named.named("permission/server")?.verdict).toBe("allow");
		expect(base.named("permission/deny")).toBeUndefined();
	});

	it("appends the form to the source and decides by it", () => {
		const next = base.with(form("(permission/deny eval)"));
		expect(next.decide("eval").verdict).toBe("deny");
		expect(next.source).toContain("(permission/deny eval)");
		expect(next.source).toContain("(permission/default ask)");
	});

	it("refuses a form that does not parse, and leaves the config alone", () => {
		expect(() => base.with(form("(permission/permit eval)"))).toThrow(
			"unknown permissions form",
		);
	});
});
