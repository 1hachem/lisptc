import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Ask, asking } from "@repo/interpreter/asks";
import { StepHold } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
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

interface Gate {
	extension: InterpExtension;
	ran(): number;
}

function gate(): Gate {
	let open = false;
	let granted = false;
	let ran = 0;
	const install = (interp: Interp): void => {
		interp.defineGlobal(
			newSym("guarded"),
			interp.makeBuiltIn("guarded", 1, (frame) => {
				if (!granted) {
					open = true;
					throw new StepHold("guarded waits for approval");
				}
				granted = false;
				ran += 1;
				return frame[0];
			}),
		);
	};
	const session = (hooks: SessionHooks): void => {
		hooks.invoke.use(async (ctx, next) => {
			if (ctx.action !== DECIDE) return next(ctx);
			open = false;
			granted = ctx.values.approved === true;
		});
		hooks.annotate.use((buffer, into, next) =>
			next(buffer, open ? asking(into, { open: [ASK] }) : into),
		);
	};
	return { extension: Object.assign(install, { session }), ran: () => ran };
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
		const g = gate();
		const r = memoryRepl([g.extension]);
		const outputs: string[] = [];
		const refused = await runAsking({
			run: async () => {
				const out = await r.evalOutput('(echo (guarded "42"))');
				outputs.push(out.user);
				return openAsks(out.annotations);
			},
			reply: async () => "y",
			answer: async (c) => {
				await r.invokeUi(c.answer.action, c.answer.values);
			},
		});
		expect(refused).toEqual([]);
		expect(g.ran()).toBe(1);
		expect(outputs.at(-1)).toContain("42");
	});

	it("stops without running the call when the ask is denied", async () => {
		const g = gate();
		const r = memoryRepl([g.extension]);
		const refused = await runAsking({
			run: async () =>
				openAsks((await r.evalOutput("(guarded 1)")).annotations),
			reply: async () => null,
			answer: async (c) => {
				await r.invokeUi(c.answer.action, c.answer.values);
			},
		});
		expect(refused).toEqual(["guarded: Denied"]);
		expect(g.ran()).toBe(0);
	});

	it("does not run the step again when the answer applied the call", async () => {
		const applied: Ask = { ...ASK, answerApplies: true };
		let runs = 0;
		const told = await runAsking({
			run: async () => {
				runs += 1;
				return [applied];
			},
			reply: async () => "y",
			answer: async () => {},
		});
		expect(runs).toBe(1);
		expect(told).toEqual(["guarded: Allowed"]);
	});
});

describe("a session client", () => {
	it("is handed the open asks with the step and can answer them", async () => {
		const g = gate();
		const path = join(tmpdir(), `lisptc-test-${randomUUID()}.sock`);
		const server = await serve(path, [g.extension]);
		const client = await SessionClient.connect(path);
		try {
			const held = await client.step('(echo (guarded "7"))');
			expect(held.asks.map((a) => a.id)).toEqual(["r1"]);
			await client.answer(DECIDE, { approved: true });
			const done = await client.step('(echo (guarded "7"))');
			expect(done.asks).toEqual([]);
			expect(done.output).toContain("7");
			expect(g.ran()).toBe(1);
		} finally {
			client.destroy();
			server.close();
		}
	});
});
