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
		messageId: string | undefined,
		request: ApprovalRequest,
		reply: ApprovalReply,
	): Promise<ApprovalOutcome>;
}

const DECIDE_ACTION = "permissions/decide";

export const uiActionTransport: ApprovalTransport = {
	async decide(chatId, messageId, request, reply) {
		const result = await postUiAction(
			chatId,
			DECIDE_ACTION,
			{ id: request.id, approved: reply.approved, scope: reply.scope },
			messageId,
		);
		if (!result.live)
			return { ok: false, error: "this session is no longer live" };
		const { error, output, message } = result.response;
		if (error)
			return { ok: false, error: output || "the decision was refused" };
		return message === undefined ? { ok: true } : { ok: true, message };
	},
};

export function approvalDecisions(
	value: unknown,
): ReadonlyMap<string, boolean> {
	const decided = new Map<string, boolean>();
	if (!value || typeof value !== "object") return decided;
	const map = (value as { decided?: unknown }).decided;
	if (!map || typeof map !== "object" || Array.isArray(map)) return decided;
	for (const [id, approved] of Object.entries(map))
		if (typeof approved === "boolean") decided.set(id, approved);
	return decided;
}

export function withDecision(
	kwargs: Record<string, unknown> | undefined,
	id: string,
	approved: boolean,
): Record<string, unknown> {
	const permissions =
		kwargs?.permissions && typeof kwargs.permissions === "object"
			? (kwargs.permissions as Record<string, unknown>)
			: {};
	const decided =
		permissions.decided && typeof permissions.decided === "object"
			? (permissions.decided as Record<string, unknown>)
			: {};
	return {
		...kwargs,
		permissions: { ...permissions, decided: { ...decided, [id]: approved } },
	};
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
