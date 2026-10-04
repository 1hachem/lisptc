import { convexQuery } from "@convex-dev/react-query";
import {
	Cancel01Icon,
	CheckmarkCircle02Icon,
	SecurityCheckIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import {
	Confirmation,
	ConfirmationAccepted,
	ConfirmationAction,
	ConfirmationActions,
	type ConfirmationApproval,
	ConfirmationRejected,
	ConfirmationRequest,
	ConfirmationTitle,
} from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { reportIssue } from "../lib/analytics.tsx";
import {
	type ApprovalReply,
	type ApprovalRequest,
	type ApprovalTransport,
	uiActionTransport,
	withDecision,
} from "../lib/approvals.ts";
import { useChatSession } from "../lib/chat.tsx";

type Transcript = FunctionReturnType<typeof api.messages.transcript>;

const CHOICES: readonly {
	label: string;
	reply: ApprovalReply;
	variant: "default" | "outline";
}[] = [
	{
		label: "Deny",
		reply: { approved: false, scope: "once" },
		variant: "outline",
	},
	{
		label: "Allow for session",
		reply: { approved: true, scope: "session" },
		variant: "outline",
	},
	{
		label: "Allow once",
		reply: { approved: true, scope: "once" },
		variant: "default",
	},
];

function transcriptKey(chatId: Id<"chats">) {
	return convexQuery(api.messages.transcript, { chatId }).queryKey;
}

function deciding(
	transcript: Transcript | undefined,
	messageId: string | undefined,
	id: string,
	approved: boolean,
): Transcript | undefined {
	return transcript?.map((row) =>
		(row.wireId ?? row._id) === messageId
			? { ...row, kwargs: withDecision(row.kwargs, id, approved) }
			: row,
	);
}

export function PermissionRequest({
	request,
	messageId,
	decided,
	transport = uiActionTransport,
}: {
	request: ApprovalRequest;
	messageId?: string;
	decided?: boolean;
	transport?: ApprovalTransport;
}) {
	const { chatId, send } = useChatSession((state) => ({
		chatId: state.chatId,
		send: state.send,
	}));
	const queryClient = useQueryClient();
	const rollback = (snapshot: Transcript | undefined) => {
		if (chatId) queryClient.setQueryData(transcriptKey(chatId), snapshot);
	};
	const mutation = useMutation({
		mutationFn: (reply: ApprovalReply) =>
			transport.decide(chatId, messageId, request, reply),
		onMutate: async (reply) => {
			if (!chatId) return undefined;
			const key = transcriptKey(chatId);
			await queryClient.cancelQueries({ queryKey: key });
			const snapshot = queryClient.getQueryData<Transcript>(key);
			queryClient.setQueryData<Transcript>(key, (current) =>
				deciding(current, messageId, request.id, reply.approved),
			);
			return { snapshot };
		},
		onError: (ex, _reply, context) => {
			reportIssue(ex, { $exception_source: "permission decision" });
			if (context) rollback(context.snapshot);
		},
		onSuccess: (outcome, _reply, context) => {
			if (!outcome.ok) {
				if (context) rollback(context.snapshot);
				return;
			}
			if (outcome.message) send(outcome.message);
		},
	});
	const refused =
		mutation.data && !mutation.data.ok
			? `${mutation.data.error}; ask again to get a new request`
			: undefined;
	const failure = mutation.error
		? mutation.error instanceof Error
			? mutation.error.message
			: String(mutation.error)
		: undefined;
	const approval: ConfirmationApproval =
		decided === undefined || refused
			? { id: request.id }
			: { id: request.id, approved: decided };
	const open = approval.approved === undefined && !refused;

	const decide = (reply: ApprovalReply) => {
		if (mutation.isPending || !open) return;
		mutation.mutate(reply);
	};

	return (
		<Confirmation
			approval={approval}
			state={open ? "approval-requested" : "approval-responded"}
			className="mt-2 gap-1.5 border-yellow/50 px-3 py-2"
		>
			<ConfirmationTitle>
				<span className="flex items-center gap-2 text-yellow">
					<HugeiconsIcon icon={SecurityCheckIcon} size={14} />
					<span className="font-mono">{request.name}</span>
				</span>
				{request.args && (
					<span className="block whitespace-pre-wrap break-words font-mono text-dim text-xs">
						{request.args}
					</span>
				)}
				<ConfirmationRequest>
					<span className="block text-dim">
						{request.reason ?? "This call needs your approval."}
					</span>
				</ConfirmationRequest>
				<ConfirmationAccepted>
					<span className="flex items-center gap-1 text-green">
						<HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} />
						Allowed
					</span>
				</ConfirmationAccepted>
				<ConfirmationRejected>
					<span className="flex items-center gap-1 text-red">
						<HugeiconsIcon icon={Cancel01Icon} size={12} />
						Denied
					</span>
				</ConfirmationRejected>
				{refused && <span className="block text-red">{refused}</span>}
				{failure && <span className="block text-red">{failure}</span>}
			</ConfirmationTitle>
			<ConfirmationActions>
				{CHOICES.map(({ label, reply, variant }) => (
					<ConfirmationAction
						key={label}
						className="h-7 px-2.5"
						variant={variant}
						disabled={mutation.isPending}
						onClick={() => decide(reply)}
					>
						{label}
					</ConfirmationAction>
				))}
			</ConfirmationActions>
		</Confirmation>
	);
}
