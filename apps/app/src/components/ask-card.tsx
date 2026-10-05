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
import { useEffect, useRef, useState } from "react";
import { reportIssue } from "../lib/analytics.tsx";
import {
	type Answered,
	type Ask,
	type AskChoice,
	type AskTransport,
	uiActionTransport,
	withAnswer,
} from "../lib/asks.ts";
import { useChatSession } from "../lib/chat.tsx";
import {
	callbackState,
	clearAuthorized,
	OAUTH_AUTHORIZED_KEY,
	OAUTH_CHANNEL,
	type OAuthSignal,
	readAuthorized,
	rememberAwaitingChat,
} from "../lib/oauth-callback.ts";

type Transcript = FunctionReturnType<typeof api.messages.transcript>;

function transcriptKey(chatId: Id<"chats">) {
	return convexQuery(api.messages.transcript, { chatId }).queryKey;
}

function answering(
	transcript: Transcript | undefined,
	messageId: string | undefined,
	id: string,
	answer: Answered,
): Transcript | undefined {
	return transcript?.map((row) =>
		(row.wireId ?? row._id) === messageId
			? { ...row, kwargs: withAnswer(row.kwargs, id, answer) }
			: row,
	);
}

function linkState(choice: AskChoice): string | undefined {
	return choice.opens === undefined ? undefined : callbackState(choice.opens);
}

function useLinkReturn(
	ask: Ask,
	open: boolean,
	answer: (choice: AskChoice) => void,
): void {
	const latest = useRef(answer);
	latest.current = answer;
	const links = ask.choices.flatMap((choice) => {
		const state = linkState(choice);
		return state === undefined ? [] : [{ state, choice }];
	});
	const awaited = links.map((l) => l.state).join(" ");
	const chosen = useRef(links);
	chosen.current = links;
	useEffect(() => {
		if (!open || awaited === "") return;
		const waiting = new Set(awaited.split(" "));
		const returned = (state: string | null): boolean => {
			const link = chosen.current.find((l) => l.state === state);
			if (link === undefined) return false;
			clearAuthorized();
			latest.current(link.choice);
			return true;
		};
		if (returned(readAuthorized())) return;
		const channel = new BroadcastChannel(OAUTH_CHANNEL);
		channel.onmessage = (e: MessageEvent<OAuthSignal>) => {
			if (e.data.type !== "authorized" || !waiting.has(e.data.state)) return;
			channel.postMessage({
				type: "answering",
				state: e.data.state,
			} satisfies OAuthSignal);
		};
		const onStorage = (e: StorageEvent) => {
			if (e.key === OAUTH_AUTHORIZED_KEY) returned(e.newValue);
		};
		window.addEventListener("storage", onStorage);
		return () => {
			channel.close();
			window.removeEventListener("storage", onStorage);
		};
	}, [awaited, open]);
}

export function AskCard({
	ask,
	messageId,
	answered,
	transport = uiActionTransport,
}: {
	ask: Ask;
	messageId?: string;
	answered?: Answered;
	transport?: AskTransport;
}) {
	const { chatId, workspaceId, resume } = useChatSession((state) => ({
		chatId: state.chatId,
		workspaceId: state.workspaceId,
		resume: state.resume,
	}));
	const queryClient = useQueryClient();
	const [linked, setLinked] = useState<string | undefined>(undefined);
	const rollback = (snapshot: Transcript | undefined) => {
		if (chatId) queryClient.setQueryData(transcriptKey(chatId), snapshot);
	};
	const mutation = useMutation({
		mutationFn: (choice: AskChoice) =>
			transport.answer(chatId, messageId, choice),
		onMutate: async (choice) => {
			if (!chatId) return undefined;
			const key = transcriptKey(chatId);
			await queryClient.cancelQueries({ queryKey: key });
			const snapshot = queryClient.getQueryData<Transcript>(key);
			queryClient.setQueryData<Transcript>(key, (current) =>
				answering(current, messageId, ask.id, {
					accepted: choice.accepts,
					label: choice.done,
				}),
			);
			return { snapshot };
		},
		onError: (ex, _choice, context) => {
			reportIssue(ex, { $exception_source: "ask answer" });
			if (context) rollback(context.snapshot);
		},
		onSuccess: (outcome, _choice, context) => {
			if (!outcome.ok) {
				if (context) rollback(context.snapshot);
				return;
			}
			if (outcome.event) resume(outcome.event);
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
		answered === undefined || refused
			? { id: ask.id }
			: { id: ask.id, approved: answered.accepted };
	const open = approval.approved === undefined && !refused;

	const answer = (choice: AskChoice) => {
		if (mutation.isPending || !open) return;
		mutation.mutate(choice);
	};

	useLinkReturn(ask, open, answer);

	const choose = (choice: AskChoice) => {
		const state = linkState(choice);
		if (choice.opens === undefined || state === undefined) {
			answer(choice);
			return;
		}
		if (chatId) rememberAwaitingChat(state, { workspaceId, chatId });
		window.open(choice.opens, "_blank", "noopener");
		setLinked(choice.label);
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
					<span className="font-mono">{ask.title}</span>
				</span>
				{ask.detail && (
					<span className="block whitespace-pre-wrap break-words font-mono text-dim text-xs">
						{ask.detail}
					</span>
				)}
				<ConfirmationRequest>
					<span className="block text-dim">
						{linked
							? "Finish in the tab that opened; this carries on when you are back."
							: ask.prompt}
					</span>
				</ConfirmationRequest>
				<ConfirmationAccepted>
					<span className="flex items-center gap-1 text-green">
						<HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} />
						{answered?.label}
					</span>
				</ConfirmationAccepted>
				<ConfirmationRejected>
					<span className="flex items-center gap-1 text-red">
						<HugeiconsIcon icon={Cancel01Icon} size={12} />
						{answered?.label}
					</span>
				</ConfirmationRejected>
				{refused && <span className="block text-red">{refused}</span>}
				{failure && <span className="block text-red">{failure}</span>}
			</ConfirmationTitle>
			<ConfirmationActions>
				{ask.choices.map((choice) => (
					<ConfirmationAction
						key={choice.label}
						className="h-7 px-2.5"
						variant={choice.primary ? "default" : "outline"}
						disabled={mutation.isPending}
						onClick={() => choose(choice)}
					>
						{choice.label}
					</ConfirmationAction>
				))}
			</ConfirmationActions>
		</Confirmation>
	);
}
