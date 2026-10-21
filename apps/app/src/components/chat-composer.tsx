import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { attachingFiles } from "../lib/attached-files.ts";
import { useChatSession } from "../lib/chat.tsx";
import { useCommandRunner } from "../lib/commands.ts";
import type { OpenFile } from "../lib/files.ts";
import { useAttachmentUpload } from "../lib/knowledge.ts";
import { sentHistory } from "../lib/message-history.ts";
import { useSymbols } from "../lib/symbols.ts";
import { useUI } from "../lib/ui.tsx";
import { ChatInput } from "./chat-input.tsx";
import type { Mentionable } from "./mention-menu.tsx";

export function ChatComposer({ about }: { about?: OpenFile }) {
	const runCommand = useCommandRunner();
	const { inputOn, sendLabel } = useUI();
	const { workspaceId, chatId, draftChatId, send, sendAbout, stop, isLoading } =
		useChatSession((state) => ({
			workspaceId: state.workspaceId,
			chatId: state.chatId,
			draftChatId: state.draftChatId,
			send: state.send,
			sendAbout: state.sendAbout,
			stop: state.stop,
			isLoading: state.isLoading,
		}));
	const { data: sent } = useQuery(
		convexQuery(api.messages.sent, { workspaceId }),
	);
	const history = useMemo(() => sentHistory(sent ?? []), [sent]);
	const { data: knowledge } = useQuery(
		convexQuery(api.knowledge.list, { workspaceId }),
	);
	const { data: attachments } = useQuery(
		convexQuery(api.attachments.list, { workspaceId }),
	);
	const mentions = useMemo<Mentionable[]>(
		() => [
			...(knowledge ?? []).map(({ name, contentType }) => ({
				folder: "knowledge" as const,
				name,
				contentType,
			})),
			...(attachments ?? []).map(({ name, contentType }) => ({
				folder: "attachments" as const,
				name,
				contentType,
			})),
		],
		[knowledge, attachments],
	);
	const toAttachments = useAttachmentUpload(workspaceId);
	const submit = useCallback(
		(text: string, attached: string[]) => {
			const annotations = attachingFiles(attached);
			if (about) sendAbout(about, text, annotations);
			else send(text, annotations);
		},
		[about, send, sendAbout],
	);
	const symbols = useSymbols(chatId ?? draftChatId, isLoading);

	return (
		<ChatInput
			placeholder={about ? `ask about ${about.path}` : "type a message"}
			onSubmit={submit}
			upload={toAttachments.upload}
			discard={toAttachments.discard}
			mentions={mentions}
			history={history}
			onCommand={runCommand}
			isStreaming={isLoading}
			onStop={stop}
			symbols={symbols}
			{...inputOn}
			sendLabel={sendLabel}
		/>
	);
}
