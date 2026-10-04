import { postUiAction } from "./ui-action.ts";

export interface ApprovalRequest {
	readonly id: string;
	readonly name: string;
	readonly args: string;
	readonly reason?: string;
}

export interface ApprovalReply {
	readonly approved: boolean;
	readonly scope: "once" | "session";
}

export type ApprovalOutcome =
	| { readonly ok: true; readonly message?: string }
	| { readonly ok: false; readonly error: string };

export interface ApprovalTransport {
	decide(
		chatId: string | null,
		request: ApprovalRequest,
		reply: ApprovalReply,
	): Promise<ApprovalOutcome>;
}

const DECIDE_ACTION = "permissions/decide";

export const uiActionTransport: ApprovalTransport = {
	async decide(chatId, request, reply) {
		const result = await postUiAction(chatId, DECIDE_ACTION, {
			id: request.id,
			approved: reply.approved,
			scope: reply.scope,
		});
		if (!result.live)
			return { ok: false, error: "this session is no longer live" };
		const { error, output, message } = result.response;
		if (error)
			return { ok: false, error: output || "the decision was refused" };
		return message === undefined ? { ok: true } : { ok: true, message };
	},
};

export interface ApprovalDecision {
	readonly id: string;
	readonly approved: boolean;
}

export function approvalDecisions(value: unknown): ApprovalDecision[] {
	if (!value || typeof value !== "object") return [];
	const decided = (value as { decided?: unknown }).decided;
	if (!Array.isArray(decided)) return [];
	return decided.flatMap((d): ApprovalDecision[] => {
		if (!d || typeof d !== "object") return [];
		const { id, approved } = d as Record<string, unknown>;
		return typeof id === "string" && typeof approved === "boolean"
			? [{ id, approved }]
			: [];
	});
}

export function approvalRequests(value: unknown): ApprovalRequest[] {
	if (!value || typeof value !== "object") return [];
	const requests = (value as { requests?: unknown }).requests;
	if (!Array.isArray(requests)) return [];
	return requests.flatMap((r): ApprovalRequest[] => {
		if (!r || typeof r !== "object") return [];
		const { id, name, args, reason } = r as Record<string, unknown>;
		if (typeof id !== "string" || typeof name !== "string") return [];
		return [
			{
				id,
				name,
				args: typeof args === "string" ? args : "",
				...(typeof reason === "string" ? { reason } : {}),
			},
		];
	});
}
