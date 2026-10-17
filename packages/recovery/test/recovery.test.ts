import { describe, expect, it } from "vitest";
import { recoveryExtension } from "../src/recovery.ts";
import { recoveryHost } from "../src/recovery-host.ts";
import { world } from "./helpers.ts";

describe("the extension", () => {
	it("takes its prompt from the host", () => {
		expect(recoveryExtension({ prompt: () => "supplied" }).prompt).toBe(
			"supplied",
		);
	});

	it("reads its colocated .ptc", () => {
		expect(recoveryExtension(recoveryHost).prompt).toMatch(/RECOVERY/);
	});
});

describe("rejected", () => {
	it("holds the code the check stopped, and asks for an edit", async () => {
		const w = world();
		const admission = await w.admit("(echo (totl xs))");
		expect(admission.rejected).toContain("totl is not defined");
		expect(admission.rejected).toContain("(rename old new)");
		expect(w.rejected()).toBe("(echo (totl xs))");
	});

	it("is cleared once a step is admitted", async () => {
		const w = world();
		await w.admit("(echo (totl xs))");
		expect(await w.admit("(echo 1)")).toEqual({ code: "(echo 1)" });
		expect(w.rejected()).toBe(null);
	});
});

describe("an edit step", () => {
	it("renames a symbol and hands the fixed code down as the step", async () => {
		const w = world();
		await w.admit("(defun total (xs) xs)\n(echo (totl '(1 2)))");
		expect(await w.admit("(rename totl total)")).toEqual({
			code: "(defun total (xs) xs)\n(echo (total '(1 2)))",
			because: "edited the code the check stopped",
			from: "(defun total (xs) xs)\n(echo (totl '(1 2)))",
		});
		expect(w.rejected()).toBe(null);
	});

	it("closes parentheses left open", async () => {
		const w = world();
		await w.admit("(echo (car '(1 2))");
		expect(await w.admit("(close-parens)")).toEqual({
			code: "(echo (car '(1 2)))",
			because: "edited the code the check stopped",
			from: expect.any(String),
		});
	});

	it("adds a missing keyword argument", async () => {
		const w = world();
		await w.admit('(load-mcp :url "x")');
		expect(await w.admit('(add-arg load-mcp :name "srv")')).toEqual({
			code: '(load-mcp :url "x" :name "srv")',
			because: "edited the code the check stopped",
			from: expect.any(String),
		});
	});

	it("pushes a positional argument before the keywords", async () => {
		const w = world();
		await w.admit("(totl :k 1)");
		const admission = await w.admit("(push-arg totl 2)");
		expect(admission.code).toBe("(totl 2 :k 1)");
		expect(w.rejected()).toBe("(totl 2 :k 1)");
	});

	it("revises text found once, and applies several edits in order", async () => {
		const w = world();
		await w.admit("(echo (totl 1)");
		expect(
			await w.admit('(revise :old "(totl 1)" :new "(+ 1 1)")\n(close-parens)'),
		).toEqual({
			code: "(echo (+ 1 1))",
			because: "edited the code the check stopped",
			from: expect.any(String),
		});
	});

	it("keeps rejected as it was when an edit fails", async () => {
		const w = world();
		await w.admit("(echo (totl xs))");
		const admission = await w.admit('(revise :old "nowhere" :new "x")');
		expect(admission.rejected).toContain("not found in rejected");
		expect(w.rejected()).toBe("(echo (totl xs))");
	});

	it("re-rejects an edit that still leaves a mistake, holding the edited code", async () => {
		const w = world();
		await w.admit("(echo (totl xs)");
		const admission = await w.admit("(close-parens)");
		expect(admission.rejected).toContain("totl is not defined");
		expect(w.rejected()).toBe("(echo (totl xs))");
	});

	it("fails when nothing was rejected", async () => {
		const w = world();
		const admission = await w.admit("(close-parens)");
		expect(admission.rejected).toContain("nothing was rejected");
	});

	it("refuses edits mixed with other code", async () => {
		const w = world();
		await w.admit("(echo (totl xs))");
		const admission = await w.admit("(rename totl total)\n(echo 1)");
		expect(admission.rejected).toContain("alone");
		expect(w.rejected()).toBe("(echo (totl xs))");
	});
});
