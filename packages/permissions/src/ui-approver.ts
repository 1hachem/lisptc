import { EvalException } from "@repo/interpreter/errors";
import { record } from "@repo/interpreter/journal";
import type { SessionHooks } from "@repo/interpreter/session";
import { type Ask, answering, asksKind } from "@repo/journal-catalog/asks";
import { resolveApproval } from "./approvals.ts";
import { lapsed, settled } from "./channel.ts";
import type { ApprovalRequest, Approvals, Approver, Scope } from "./ports.ts";

export const DECIDE_ACTION = "permissions/decide";

const NEEDS_APPROVAL = "This call needs your approval.";

const DONE = {
	denied: "Denied",
	session: "Allowed for session",
	always: "Always allowed",
	once: "Allowed",
} as const;

const EXPIRED = "Expired";

function approvalAsk(request: ApprovalRequest): Ask {
	const answer = (approved: boolean, scope: Scope) => ({
		action: DECIDE_ACTION,
		values: { id: request.id, approved, scope },
	});
	return {
		id: request.id,
		title: request.name,
		...(request.args ? { detail: request.args } : {}),
		prompt: request.reason ?? NEEDS_APPROVAL,
		...(request.change ? { answerApplies: true as const } : {}),
		choices: [
			{
				label: "Deny",
				done: DONE.denied,
				accepts: false,
				answer: answer(false, "once"),
			},
			...(request.change
				? []
				: [
						{
							label: "Always allow",
							done: DONE.always,
							accepts: true,
							answer: answer(true, "always"),
						},
					]),
			{
				label: "Allow for session",
				done: DONE.session,
				accepts: true,
				answer: answer(true, "session"),
			},
			{
				label: "Allow once",
				done: DONE.once,
				accepts: true,
				answer: answer(true, "once"),
				primary: true,
			},
		],
	};
}

export const uiApprover: Approver = {
	kind: "ui",
	ask(request, channels) {
		record(channels, asksKind, { open: [approvalAsk(request)] });
	},
	session(hooks: SessionHooks, approvals: Approvals): void {
		hooks.invoke.use(async (ctx, next) => {
			if (ctx.action !== DECIDE_ACTION) return next(ctx);
			const { id, approved, scope } = ctx.values;
			if (typeof id !== "string")
				throw new EvalException("a decision names no request", id, false);
			const resolution = resolveApproval(approvals, {
				id,
				approved: approved === true || approved === "true",
				scope: scopeOf(scope),
				by: "ui",
			});
			if (resolution === undefined) {
				lapsed.emit(ctx.interp.channels, { user: id });
				record(
					ctx.interp.channels,
					asksKind,
					answering(id, { accepted: false, label: EXPIRED }),
				);
				throw new EvalException(
					"no such approval request, or it was already decided",
					id,
					false,
				);
			}
			settled.emit(ctx.interp.channels, {
				user: {
					id,
					approved: resolution.decision.approved,
					scope: resolution.decision.scope,
				},
			});
			const { approved: accepted, scope: decidedScope } = resolution.decision;
			record(
				ctx.interp.channels,
				asksKind,
				answering(id, {
					accepted,
					label: accepted ? DONE[decidedScope] : DONE.denied,
				}),
			);
			ctx.interp.conversation.append("permissions", resolution.message);
		});
	},
};

function scopeOf(x: unknown): Scope {
	return x === "session" || x === "always" ? x : "once";
}
