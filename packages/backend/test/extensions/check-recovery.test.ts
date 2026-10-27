import { conversationExtension } from "@repo/conversation-extension";
import { conversationHost } from "@repo/conversation-extension/host";
import { lintExtension } from "@repo/lint-extension";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { recoveryExtension } from "@repo/recovery-extension";
import { recoveryHost } from "@repo/recovery-extension/host";
import { describe, expect, it } from "vitest";
import { agentRepl } from "./helpers.ts";

function checked() {
	return agentRepl([
		proseExtension(proseHost),
		conversationExtension(conversationHost),
		recoveryExtension(recoveryHost),
		lintExtension(),
	]);
}

describe("several broken forms, repaired through the conversation", () => {
	it("finds each failed form and repairs them all in one step", async () => {
		const repl = checked();
		await repl.turnStart();
		const code = "(echo pricez)\n(echo (car))";
		const stopped = await repl.admit(code);
		expect(stopped.problems).toEqual([
			{ line: 1, message: "pricez is not defined" },
			{ line: 2, message: "car: expected 1 argument, got 0" },
		]);
		repl.recorded({ role: "assistant", content: code });
		repl.recorded({
			role: "tool",
			content: stopped.rejected ?? "",
			...(stopped.problems ? { problems: stopped.problems } : {}),
		});
		await repl.beginStep();
		expect((await repl.evalOutput("(echo (length (failed-forms)))")).user).toBe(
			"2\n",
		);
		const repaired = await repl.admit(
			"(rename pricez 42 :in (car (failed-forms)))\n(push-arg car '(1 2))",
		);
		expect(repaired.rejected).toBeUndefined();
		expect(repaired.code).toMatch(/^\(echo 42\)\n\(echo \(car /);
	});
});

describe("a form left open among other broken forms", () => {
	it("reports the forms before it, and repairs each by edit", async () => {
		const repl = checked();
		await repl.turnStart();
		const code = "(echo (car))\n(echo (+ 1 2)\n(echo (length '(1 2)))";
		const stopped = await repl.admit(code);
		expect(stopped.problems).toEqual([
			{ line: 1, message: "car: expected 1 argument, got 0" },
			{
				line: 2,
				message: 'unexpected end of input, this "(" is never closed',
			},
		]);
		repl.recorded({ role: "assistant", content: code });
		repl.recorded({
			role: "tool",
			content: stopped.rejected ?? "",
			...(stopped.problems ? { problems: stopped.problems } : {}),
		});
		await repl.beginStep();
		const tooFar = await repl.admit(
			"(push-arg car '(1 2) :in (car (failed-forms)))\n(close-parens :in (nth 2 (failed-forms)))",
		);
		expect(tooFar.rejected).toContain(
			"(close-parens :in (nth 2 (failed-forms))) failed: :in takes an entry",
		);
		expect(tooFar.rejected).toContain("edit 2 of 2 failed");
		const repaired = await repl.admit(
			"(close-parens)\n(push-arg car '(1 2) :in (get-in (car (failed-forms)) :form))",
		);
		expect(repaired.rejected).toBeUndefined();
		expect(repaired.code).toBe(
			"(echo (car '(1 2)))\n(echo (+ 1 2))\n(echo (length '(1 2)))",
		);
	});
});

describe("a stopped step read back before it is repaired", () => {
	it("still takes an edit after a step that only looked at it", async () => {
		const repl = checked();
		await repl.turnStart();
		const code = "(echo (car))";
		const stopped = await repl.admit(code);
		repl.recorded({ role: "assistant", content: code });
		repl.recorded({
			role: "tool",
			content: stopped.rejected ?? "",
			...(stopped.problems ? { problems: stopped.problems } : {}),
		});
		await repl.beginStep();
		expect(
			(await repl.admit("(echo (failed-forms))")).rejected,
		).toBeUndefined();
		expect(await repl.admit("(push-arg car '(1 2 3))")).toMatchObject({
			code: "(echo (car '(1 2 3)))",
			from: code,
		});
	});
});

describe("a step the check stops, repaired by an edit", () => {
	it("pushes the argument a call was missing, and admits the result", async () => {
		const repl = checked();
		await repl.eval("(defun total (a b) (+ a b))");
		const stopped = await repl.admit("(echo (total 1))");
		expect(stopped.rejected).toContain("total: expected 2 arguments, got 1");
		expect(stopped.rejected).toContain("(push-arg f value)");
		expect(await repl.admit("(push-arg total 2)")).toEqual({
			code: "(echo (total 1 2))",
			because: "edited the code the check stopped",
			from: expect.any(String),
		});
	});

	it("closes what did not read, with prose around the edit", async () => {
		const repl = checked();
		const stopped = await repl.admit("(echo (+ 1 2)");
		expect(stopped.rejected).toContain("line 1: unexpected end of input");
		expect((await repl.evalOutput("(echo rejected)")).user).toContain(
			"(echo (+ 1 2)",
		);
		expect(await repl.admit("Closing it.\n(close-parens)")).toEqual({
			code: "(echo (+ 1 2))",
			because: "edited the code the check stopped",
			from: expect.any(String),
		});
	});

	it("takes edits whose prose quotes code in backticks", async () => {
		const repl = checked();
		await repl.admit("(echo (car))");
		expect(
			await repl.admit(
				"Form 1 (`(echo (car))`) passes `car` nothing, so:\n(push-arg car '(1 2))",
			),
		).toMatchObject({ code: "(echo (car '(1 2)))" });
	});

	it("holds an edit that is still wrong as the new rejected code", async () => {
		const repl = checked();
		await repl.admit("(echo (car)");
		const again = await repl.admit("(close-parens)");
		expect(again.rejected).toContain("car: expected 1 argument, got 0");
		expect((await repl.evalOutput("(echo rejected)")).user).toContain(
			"(echo (car))",
		);
	});

	it("admits prose whose open parenthesis opens no form", async () => {
		expect(await checked().admit("that went badly :(")).toEqual({
			code: "that went badly :(",
		});
	});
});
