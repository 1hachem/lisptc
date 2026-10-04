import {
	Cancel01Icon,
	CheckmarkCircle02Icon,
	SecurityCheckIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
import { useState } from "react";
import { reportIssue } from "../lib/analytics.tsx";
import {
	type ApprovalReply,
	type ApprovalRequest,
	type ApprovalTransport,
	uiActionTransport,
} from "../lib/approvals.ts";
import { useChatSession } from "../lib/chat.tsx";

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

export function PermissionRequest({
	request,
	decided,
	transport = uiActionTransport,
}: {
	request: ApprovalRequest;
	decided?: boolean;
	transport?: ApprovalTransport;
}) {
	const { chatId, send } = useChatSession((state) => ({
		chatId: state.chatId,
		send: state.send,
	}));
	const [busy, setBusy] = useState(false);
	const [chosen, setChosen] = useState<boolean>();
	const [failure, setFailure] = useState<string>();
	const approved = chosen ?? decided;
	const approval: ConfirmationApproval =
		approved === undefined ? { id: request.id } : { id: request.id, approved };

	const decide = (reply: ApprovalReply) => {
		if (busy || approval.approved !== undefined) return;
		setBusy(true);
		setFailure(undefined);
		void (async () => {
			try {
				const outcome = await transport.decide(chatId, request, reply);
				if (!outcome.ok) {
					setFailure(outcome.error);
					return;
				}
				setChosen(reply.approved);
				if (outcome.message) send(outcome.message);
			} catch (ex) {
				reportIssue(ex, { $exception_source: "permission decision" });
				setFailure(ex instanceof Error ? ex.message : String(ex));
			} finally {
				setBusy(false);
			}
		})();
	};

	return (
		<Confirmation
			approval={approval}
			state={
				approval.approved === undefined
					? "approval-requested"
					: "approval-responded"
			}
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
				{failure && <span className="block text-red">{failure}</span>}
			</ConfirmationTitle>
			<ConfirmationActions>
				{CHOICES.map(({ label, reply, variant }) => (
					<ConfirmationAction
						key={label}
						className="h-7 px-2.5"
						variant={variant}
						disabled={busy}
						onClick={() => decide(reply)}
					>
						{label}
					</ConfirmationAction>
				))}
			</ConfirmationActions>
		</Confirmation>
	);
}
