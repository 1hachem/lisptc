import { EvalException } from "@repo/interpreter/errors";
import { annotating, type SessionHooks } from "@repo/interpreter/session";
import { resolveApproval } from "./approvals.ts";
import { decided, requested } from "./channel.ts";
import type { Approvals, Approver, Scope } from "./ports.ts";

export const DECIDE_ACTION = "permissions/decide";

export interface Settled {
	readonly id: string;
	readonly approved: boolean;
}

export const uiApprover: Approver = {
	kind: "ui",
	session(hooks: SessionHooks, approvals: Approvals): void {
		let unreported: Settled[] = [];
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
			unreported.push({ id, approved: resolution.decision.approved });
			decided.emit(ctx.interp.channels, { user: resolution.message });
		});
		hooks.annotate.use((buffer, into, next) => {
			const requests = buffer.collect(requested);
			const deciding = buffer.collect(decided).length > 0;
			const settled = deciding ? [] : unreported;
			if (!deciding) unreported = [];
			const permissions = {
				...(requests.length === 0 ? {} : { requests }),
				...(settled.length === 0 ? {} : { decided: settled }),
			};
			return next(
				buffer,
				Object.keys(permissions).length === 0
					? into
					: annotating(into, "step", { permissions }),
			);
		});
		hooks.message.use((buffer, next) => {
			const messages = buffer.collect(decided);
			return messages.length === 0 ? next(buffer) : messages.join("\n\n");
		});
	},
};

function scopeOf(x: unknown): Scope {
	return x === "session" ? "session" : "once";
}
