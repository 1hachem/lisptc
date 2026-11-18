import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StepHold } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { type Ask, asksKind } from "@repo/journal-catalog/asks";
import { describe, expect, it } from "vitest";
import { openAsks, runAsking, yesOrNo } from "../src/asks.ts";
import { SessionClient, serve } from "../src/session-server.ts";
import { memoryRepl } from "./helpers.ts";

const DECIDE = "test/decide";

const ASK: Ask = {
	id: "r1",
	title: "guarded",
	prompt: "This call needs your approval.",
	choices: [
		{
			label: "Deny",
			done: "Denied",
			accepts: false,
			answer: { action: DECIDE, values: { approved: false } },
		},
		{
			label: "Allow for session",
			done: "Allowed for session",
			accepts: true,
			answer: { action: DECIDE, values: { approved: true } },
		},
		{
			label: "Allow once",
			done: "Allowed",
			accepts: true,
			answer: { action: DECIDE, values: { approved: true } },
			primary: true,
		},
	],
};

function gate(ask: Ask = ASK): InterpExtension {
	let granted = false;
	const install = (interp: Interp): void => {
		interp.defineGlobal(
			newSym("guarded"),
			interp.makeBuiltIn("guarded", 1, (frame) => {
				if (!granted) {
					interp.journal.write(asksKind, { open: [ask] });
					throw new StepHold("guarded waits for approval");
				}
				granted = false;
				return frame[0];
			}),
		);
	};
	const session = (hooks: SessionHooks): void => {
		hooks.invoke.use(async (ctx, next) => {
			if (ctx.action !== DECIDE) return next(ctx);
			granted = ctx.values.approved === true;
		});
	};
	return Object.assign(install, { session });
}

describe("a y/N reply", () => {
	it("takes the primary accepting choice on yes", () => {
		expect(yesOrNo(ASK, "y")?.label).toBe("Allow once");
		expect(yesOrNo(ASK, " YES ")?.label).toBe("Allow once");
	});

	it("denies on anything else, an empty reply included", () => {
		expect(yesOrNo(ASK, "")?.label).toBe("Deny");
		expect(yesOrNo(ASK, "n")?.label).toBe("Deny");
		expect(yesOrNo(ASK, "sure")?.label).toBe("Deny");
	});
});

describe("asking around a step", () => {
	it("reruns the step once the ask is approved", async () => {
		const r = memoryRepl([gate()]);
		const outputs: string[] = [];
		const refused = await runAsking({
			run: async () => {
				const out = await r.evalOutput('(echo (guarded "42"))');
				outputs.push(out.user);
				return openAsks(out.entries);
			},
			reply: async () => "y",
			answer: async (c) => {
				await r.invokeUi(c.answer.action, c.answer.values);
			},
		});
		expect(refused).toEqual([]);
		expect(outputs.at(-1)).toBe("42\n");
	});

	it("stops without running the call when the ask is denied", async () => {
		const r = memoryRepl([gate()]);
		const outputs: string[] = [];
		const refused = await runAsking({
			run: async () => {
				const out = await r.evalOutput('(echo (guarded "41"))');
				outputs.push(out.user);
				return openAsks(out.entries);
			},
			reply: async () => null,
			answer: async (c) => {
				await r.invokeUi(c.answer.action, c.answer.values);
			},
		});
		expect(refused).toEqual(["guarded: Denied"]);
		expect(outputs.join("")).not.toContain("41");
	});

	it("does not run the step again when the answer applied the call", async () => {
		const r = memoryRepl([gate({ ...ASK, answerApplies: true })]);
		await r.evalOutput("(setq runs 0)");
		const told = await runAsking({
			run: async () =>
				openAsks(
					(await r.evalOutput("(progn (setq runs (+ runs 1)) (guarded 1))"))
						.entries,
				),
			reply: async () => "y",
			answer: async (c) => {
				await r.invokeUi(c.answer.action, c.answer.values);
			},
		});
		expect(told).toEqual(["guarded: Allowed"]);
		expect((await r.evalOutput("(echo runs)")).user).toBe("1\n");
	});
});

describe("a session client", () => {
	it("is handed the open asks with the step and can answer them", async () => {
		const path = join(tmpdir(), `lisptc-test-${randomUUID()}.sock`);
		const server = await serve(path, [gate()]);
		const client = await SessionClient.connect(path);
		try {
			const held = await client.step('(echo (guarded "7"))');
			expect(held.asks.map((a) => a.id)).toEqual(["r1"]);
			await client.answer(DECIDE, { approved: true });
			const done = await client.step('(echo (guarded "7"))');
			expect(done.asks).toEqual([]);
			expect(done.output).toContain("7");
		} finally {
			client.destroy();
			server.close();
		}
	});
});
