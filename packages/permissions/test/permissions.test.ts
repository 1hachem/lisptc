import { describe, expect, it } from "vitest";
import { resolveApproval } from "../src/approvals.ts";
import { DECIDE_ACTION } from "../src/ui-approver.ts";
import { recordingApprover, session } from "./helpers.ts";

const UPCASE = '(string-upcase "a")';

describe("the permissions guard", () => {
	it("refuses a denied form with its reason, and tells the model it is final", async () => {
		const s = session('(permission/deny string-upcase :reason "not today")');
		const run = await s.step(UPCASE);
		expect(run.failed).toBe(true);
		expect(run.report).toContain("not today");
		expect(run.report).toContain("Do not call it again");
	});

	it("refuses a form however it is reached", async () => {
		const s = session("(permission/deny string-upcase)");
		expect((await s.step('(apply string-upcase \'("a"))')).failed).toBe(true);
		expect((await s.step('(setq up string-upcase) (up "a")')).failed).toBe(
			true,
		);
	});

	it("bans a special form", async () => {
		const s = session("(permission/deny setq)");
		expect((await s.step("(setq x 1)")).failed).toBe(true);
	});

	it("leaves what it allows alone", async () => {
		const s = session("(permission/deny string-upcase)");
		expect((await s.step('(string-downcase "A")')).value).toBe('"a"');
	});

	it("stays out of the way outside a step, so the prelude still loads", () => {
		expect(() => session("(permission/default deny)")).not.toThrow();
	});

	it("asks, emits the request on its channel and annotates the step", async () => {
		const s = session("(permission/ask string-upcase)");
		const run = await s.step(UPCASE);
		expect(run.failed).toBe(false);
		expect(run.held).toBe(true);
		expect(run.report).toContain("waiting for the user's approval");
		expect(run.report).toContain("The turn ends here");
		expect(run.requests).toEqual([
			expect.objectContaining({ name: "string-upcase", args: '"a"' }),
		]);
		expect(run.requests[0].change).toBeUndefined();
		expect(run.annotations.output).toEqual({
			asks: {
				open: [
					{
						id: run.requests[0].id,
						title: "string-upcase",
						detail: '"a"',
						prompt: "This call needs your approval.",
						choices: ["Deny", "Allow for session", "Allow once"].map((label) =>
							expect.objectContaining({ label }),
						),
					},
				],
			},
		});
	});

	it("runs a call approved once, then asks again", async () => {
		const s = session("(permission/ask string-upcase)");
		const [request] = (await s.step(UPCASE)).requests;
		const decided = await s.invoke(DECIDE_ACTION, {
			id: request.id,
			approved: true,
			scope: "once",
		});
		expect(decided.failed).toBe(false);
		expect(decided.message).toContain("approved string-upcase for one call");
		expect((await s.step(UPCASE)).value).toBe('"A"');
		const again = await s.step(UPCASE);
		expect(again.failed).toBe(false);
		expect(again.held).toBe(true);
	});

	it("keeps a session grant", async () => {
		const s = session("(permission/ask string-upcase)");
		const [request] = (await s.step(UPCASE)).requests;
		await s.invoke(DECIDE_ACTION, {
			id: request.id,
			approved: "true",
			scope: "session",
		});
		expect((await s.step(UPCASE)).value).toBe('"A"');
		expect((await s.step('(string-upcase "b")')).value).toBe('"B"');
	});

	it("grants nothing on a denial, and says so", async () => {
		const s = session("(permission/ask string-upcase)");
		const [request] = (await s.step(UPCASE)).requests;
		const decided = await s.invoke(DECIDE_ACTION, {
			id: request.id,
			approved: false,
			scope: "session",
		});
		expect(decided.message).toContain("denied string-upcase");
		const retried = await s.step(UPCASE);
		expect(retried.failed).toBe(false);
		expect(retried.held).toBe(true);
		expect(retried.value).toBeUndefined();
	});

	it("refuses a decision for a request that is not open", async () => {
		const s = session("(permission/ask string-upcase)");
		const decided = await s.invoke(DECIDE_ACTION, {
			id: "nope",
			approved: true,
		});
		expect(decided.failed).toBe(true);
	});

	it("passes every other action on", async () => {
		const s = session("(permission/ask string-upcase)");
		expect((await s.invoke("ui/click", {})).failed).toBe(true);
	});

	it("hands each request to every approver, and any reply path unlocks the retry", async () => {
		const email = recordingApprover();
		const s = session("(permission/ask string-upcase)", [email]);
		await s.step(UPCASE);
		expect(email.asked.map((r) => r.name)).toEqual(["string-upcase"]);
		const resolution = resolveApproval(s.host.approvals, {
			id: email.asked[0].id,
			approved: true,
			scope: "once",
			by: "email",
		});
		expect(resolution?.request.name).toBe("string-upcase");
		expect((await s.step(UPCASE)).value).toBe('"A"');
	});
});

describe("the permissions surface", () => {
	it("reads the config back and answers for a name", async () => {
		const s = session("(permission/deny eval) (permission/ask string-upcase)");
		expect((await s.step("(permission/list)")).value).toBe(
			"((permission/deny eval) (permission/ask string-upcase))",
		);
		expect((await s.step("(permission/check 'eval)")).value).toBe("deny");
		expect((await s.step("(permission/check 'car)")).value).toBe("allow");
	});
});

describe("evaluating a permissions form", () => {
	it("asks before any change, even one that tightens the config", async () => {
		const s = session("");
		const tighten = "(permission/deny string-upcase)";
		const asked = await s.step(tighten);
		expect(asked.failed).toBe(false);
		expect(asked.held).toBe(true);
		expect(asked.requests).toEqual([
			expect.objectContaining({
				name: tighten,
				reason: "changes the permissions config",
			}),
		]);
		expect((await s.step(UPCASE)).value).toBe('"A"');
		expect(s.host.store.source()).toBe("");

		const decided = await s.invoke(DECIDE_ACTION, {
			id: asked.requests[0].id,
			approved: true,
			scope: "once",
		});
		expect(decided.failed).toBe(false);
		expect(s.host.store.source()).toContain(tighten);
		expect((await s.step(UPCASE)).failed).toBe(true);
	});

	it("applies at once when a rule names the operation", async () => {
		const s = session("(permission/allow permission/deny)");
		const run = await s.step("(permission/deny string-upcase)");
		expect(run.failed).toBe(false);
		expect(run.requests).toEqual([]);
		expect((await s.step(UPCASE)).failed).toBe(true);
	});

	it("refuses without asking when a rule denies the operation", async () => {
		const s = session(
			'(permission/deny permission/allow :reason "the config is fixed")',
		);
		const run = await s.step("(permission/allow eval)");
		expect(run.failed).toBe(true);
		expect(run.requests).toEqual([]);
		expect(run.report).toContain("the config is fixed");
	});

	it("lets a rule ask with its own reason", async () => {
		const s = session(
			'(permission/ask permission/server :reason "servers are reviewed")',
		);
		const run = await s.step("(permission/server gh (hide admin_*))");
		expect(run.requests).toEqual([
			expect.objectContaining({ reason: "servers are reviewed" }),
		]);
	});

	it("shows only what a server form names, from the repl", async () => {
		const s = session("(permission/allow permission/server)");
		await s.step("(permission/server playwright (only browser_navigate))");
		expect(s.extension.rules.tool("playwright", "browser_click")).toBe(false);
		expect(s.extension.rules.tool("playwright", "browser_navigate")).toBe(true);
		expect(s.host.store.source()).toBe(
			"(permission/allow permission/server)\n(permission/server playwright (only browser_navigate))\n",
		);
	});

	it("holds a widening form for the user's approval, and applies it once approved", async () => {
		const s = session("(permission/deny string-upcase)");
		const widen = "(permission/allow string-upcase)";
		const asked = await s.step(widen);
		expect(asked.failed).toBe(false);
		expect(asked.held).toBe(true);
		expect(asked.report).toContain(
			"changes the permissions config and is waiting for the user's approval",
		);
		expect(asked.report).toContain(
			"once they approve it is applied, so do not run it again",
		);
		expect(asked.requests).toEqual([
			expect.objectContaining({ name: widen, change: true }),
		]);
		expect(s.host.store.source()).not.toContain(widen);

		const decided = await s.invoke(DECIDE_ACTION, {
			id: asked.requests[0].id,
			approved: true,
			scope: "once",
		});
		expect(decided.failed).toBe(false);
		expect(decided.message).toBe(
			`I approved ${widen}, and it is applied to the permissions config.`,
		);
		expect(s.host.store.source()).toBe(
			"(permission/deny string-upcase)\n(permission/allow string-upcase)\n",
		);
		expect(s.host.approvals.pending()).toEqual([]);
	});

	it("applies a change approved through any reply path", async () => {
		const email = recordingApprover();
		const s = session("", [email]);
		const tighten = "(permission/deny string-upcase)";
		await s.step(tighten);
		const resolution = resolveApproval(s.host.approvals, {
			id: email.asked[0].id,
			approved: true,
			scope: "once",
			by: "email",
		});
		expect(resolution?.message).toBe(
			`I approved ${tighten}, and it is applied to the permissions config.`,
		);
		expect(s.host.store.source()).toBe(`${tighten}\n`);
		expect((await s.step(UPCASE)).failed).toBe(true);
	});

	it("asks again for a change that is already applied, rather than applying it twice", async () => {
		const s = session("");
		const tighten = "(permission/deny string-upcase)";
		const first = await s.step(tighten);
		await s.invoke(DECIDE_ACTION, {
			id: first.requests[0].id,
			approved: true,
			scope: "session",
		});
		const applied = s.host.store.source();
		expect(applied).toBe(`${tighten}\n`);

		const again = await s.step(tighten);
		expect(again.failed).toBe(false);
		expect(again.held).toBe(true);
		expect(again.requests).toEqual([
			expect.objectContaining({ name: tighten, change: true }),
		]);
		expect(again.requests[0].id).not.toBe(first.requests[0].id);
		expect(s.host.store.source()).toBe(applied);
	});

	it("never applies a widening form the user denied", async () => {
		const s = session("(permission/deny string-upcase)");
		const widen = "(permission/allow string-upcase)";
		const asked = await s.step(widen);
		const decided = await s.invoke(DECIDE_ACTION, {
			id: asked.requests[0].id,
			approved: false,
		});
		expect(decided.message).toBe(
			`I denied ${widen}, so the permissions config is unchanged.`,
		);
		expect(s.host.store.source()).toBe("(permission/deny string-upcase)");
		const retried = await s.step(widen);
		expect(retried.failed).toBe(false);
		expect(retried.held).toBe(true);
		expect(s.host.store.source()).not.toContain(widen);
		expect((await s.step(UPCASE)).failed).toBe(true);
	});

	it("asks rather than refuses under a default that denies, since only a named rule decides", async () => {
		const s = session("(permission/default deny)");
		const run = await s.step("(permission/deny eval)");
		expect(run.requests).toHaveLength(1);
	});

	it("still runs under a default that denies when a rule names the operation", async () => {
		const s = session(
			"(permission/default deny) (permission/allow permission/deny)",
		);
		expect((await s.step("(permission/deny eval)")).failed).toBe(false);
		expect(s.host.store.source()).toContain("(permission/deny eval)");
	});

	it("refuses a malformed form and changes nothing", async () => {
		const s = session("(permission/deny eval)");
		expect((await s.step("(permission/deny)")).failed).toBe(true);
		expect(s.host.store.source()).toBe("(permission/deny eval)");
	});

	it("cannot be routed around by rebinding the forms", async () => {
		const s = session("(permission/deny string-upcase)");
		await s.step("(setq permission/apply (lambda (f) f))");
		await s.step("(permission/allow string-upcase)");
		expect((await s.step(UPCASE)).failed).toBe(true);
	});
});

describe("deleting a permissions form", () => {
	const DELETE = "(permission/delete (permission/deny string-upcase))";

	it("waits for the user's approval, and changes nothing until then", async () => {
		const s = session("(permission/deny string-upcase)");
		const asked = await s.step(DELETE);
		expect(asked.failed).toBe(false);
		expect(asked.held).toBe(true);
		expect(asked.report).toContain(
			"changes the permissions config and is waiting for the user's approval",
		);
		expect(asked.requests).toEqual([
			expect.objectContaining({
				name: DELETE,
				reason: "changes the permissions config",
			}),
		]);
		expect((await s.step(UPCASE)).failed).toBe(true);
		expect(s.host.store.source()).toBe("(permission/deny string-upcase)");
	});

	it("removes the form once approved, and saves the config without it", async () => {
		const s = session(
			"(permission/deny string-upcase)\n(permission/deny eval)\n",
		);
		const [request] = (await s.step(DELETE)).requests;
		expect(request.change).toBe(true);
		const decided = await s.invoke(DECIDE_ACTION, {
			id: request.id,
			approved: true,
			scope: "once",
		});
		expect(decided.message).toBe(
			`I approved ${DELETE}, and it is applied to the permissions config.`,
		);
		expect(s.host.store.source()).toBe("(permission/deny eval)\n");
		expect((await s.step(UPCASE)).value).toBe('"A"');
		expect((await s.step("(permission/check 'eval)")).value).toBe("deny");
	});

	it("asks even when the deletion would tighten the config", async () => {
		const s = session("(permission/allow string-upcase)");
		const asked = await s.step(
			"(permission/delete (permission/allow string-upcase))",
		);
		expect(asked.failed).toBe(false);
		expect(asked.held).toBe(true);
		expect(asked.requests).toHaveLength(1);
	});

	it("never deletes once the user denies it", async () => {
		const s = session("(permission/deny string-upcase)");
		const [request] = (await s.step(DELETE)).requests;
		const decided = await s.invoke(DECIDE_ACTION, {
			id: request.id,
			approved: false,
		});
		expect(decided.message).toBe(
			`I denied ${DELETE}, so the permissions config is unchanged.`,
		);
		expect(s.host.store.source()).toBe("(permission/deny string-upcase)");
		const retried = await s.step(DELETE);
		expect(retried.failed).toBe(false);
		expect(retried.held).toBe(true);
		expect(s.host.store.source()).toBe("(permission/deny string-upcase)");
		expect((await s.step(UPCASE)).failed).toBe(true);
	});

	it("refuses a form the config does not hold, without asking", async () => {
		const s = session("(permission/deny eval)");
		const run = await s.step("(permission/delete (permission/deny read))");
		expect(run.failed).toBe(true);
		expect(run.requests).toEqual([]);
	});

	it("deletes at once when a rule allows deleting", async () => {
		const s = session(
			"(permission/allow permission/delete)\n(permission/deny string-upcase)\n",
		);
		const run = await s.step(DELETE);
		expect(run.failed).toBe(false);
		expect(run.requests).toEqual([]);
		expect((await s.step(UPCASE)).value).toBe('"A"');
	});

	it("never deletes when a rule denies deleting", async () => {
		const s = session(
			"(permission/deny permission/delete)\n(permission/deny string-upcase)\n",
		);
		const run = await s.step(DELETE);
		expect(run.failed).toBe(true);
		expect(run.requests).toEqual([]);
		expect((await s.step(UPCASE)).failed).toBe(true);
	});

	it("takes exactly one form", async () => {
		const s = session("(permission/deny eval)");
		expect((await s.step("(permission/delete)")).failed).toBe(true);
		expect(s.host.store.source()).toBe("(permission/deny eval)");
	});
});

describe("reporting a decision", () => {
	it("carries a ui decision on the decide action's output lane, once", async () => {
		const s = session("(permission/ask string-upcase)");
		const [request] = (await s.step(UPCASE)).requests;
		const decided = await s.invoke(DECIDE_ACTION, {
			id: request.id,
			approved: true,
			scope: "once",
		});
		expect(decided.annotations).toEqual({
			step: {},
			output: {
				asks: {
					answered: { [request.id]: { accepted: true, label: "Allowed" } },
				},
			},
		});
		expect(decided.message).toMatch(/approved/);
		expect((await s.turnStart()).annotations).toEqual({ step: {}, output: {} });
		expect((await s.step("(+ 1 2)")).annotations).toEqual({
			step: {},
			output: {},
		});
	});

	it("reports a denial as a decision too", async () => {
		const s = session("(permission/ask string-upcase)");
		const [request] = (await s.step(UPCASE)).requests;
		const denied = await s.invoke(DECIDE_ACTION, {
			id: request.id,
			approved: false,
		});
		expect(denied.annotations.output).toEqual({
			asks: {
				answered: { [request.id]: { accepted: false, label: "Denied" } },
			},
		});
		expect(denied.message).toMatch(/denied/);
		expect((await s.turnStart()).annotations).toEqual({ step: {}, output: {} });
	});
});
