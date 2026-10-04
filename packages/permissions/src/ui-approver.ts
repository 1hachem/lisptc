import { type Ask, asking } from "@repo/interpreter/asks";
import { EvalException } from "@repo/interpreter/errors";
import type { SessionHooks } from "@repo/interpreter/session";
import { resolveApproval } from "./approvals.ts";
import { decided, requested, settled } from "./channel.ts";
import type { ApprovalRequest, Approvals, Approver, Scope } from "./ports.ts";

export const DECIDE_ACTION = "permissions/decide";

const NEEDS_APPROVAL = "This call needs your approval.";

const DONE = {
	denied: "Denied",
	session: "Allowed for session",
	once: "Allowed",
} as const;

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
		choices: [
			{
				label: "Deny",
				done: DONE.denied,
				accepts: false,
				answer: answer(false, "once"),
			},
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
			if (resolution === undefined)
				throw new EvalException(
					"no such approval request, or it was already decided",
					id,
					false,
				);
			settled.emit(ctx.interp.channels, {
				user: {
					id,
					approved: resolution.decision.approved,
					scope: resolution.decision.scope,
				},
			});
			decided.emit(ctx.interp.channels, { user: resolution.message });
		});
		hooks.annotate.use((buffer, into, next) =>
			next(
				buffer,
				asking(into, {
					open: buffer.collect(requested).map(approvalAsk),
					answered: Object.fromEntries(
						buffer.collect(settled).map((d) => [
							d.id,
							{
								accepted: d.approved,
								label: d.approved ? DONE[d.scope] : DONE.denied,
							},
						]),
					),
				}),
			),
		);
		hooks.message.use((buffer, next) => {
			const messages = buffer.collect(decided);
			return messages.length === 0 ? next(buffer) : messages.join("\n\n");
		});
	},
};

function scopeOf(x: unknown): Scope {
	return x === "session" ? "session" : "once";
}
