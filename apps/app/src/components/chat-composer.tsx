import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Question } from "@repo/interpreter/annotations";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useAnchor } from "../lib/anchors.ts";
import { attachingFiles } from "../lib/attached-files.ts";
import { useChatSession } from "../lib/chat.tsx";
import { useCommandRunner } from "../lib/commands.ts";
import type { OpenFile } from "../lib/files.ts";
import { sentHistory } from "../lib/message-history.ts";
import { useSymbols } from "../lib/symbols.ts";
import { useUI } from "../lib/ui.tsx";
import { useAttachmentUpload } from "../lib/uploads.ts";
import { ChatInput } from "./chat-input.tsx";
import type { Mentionable } from "./mention-menu.tsx";

export function ChatComposer({
	about,
	blocked,
	question,
}: {
	about?: OpenFile;
	blocked?: string;
	question?: Question;
}) {
	const runCommand = useCommandRunner();
	const { inputOn } = useUI();
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
		convexQuery(api.files.list, { workspaceId, folder: "knowledge" }),
	);
	const { data: attachments } = useQuery(
		convexQuery(api.files.list, { workspaceId, folder: "attachments" }),
	);
	const { data: agents } = useQuery(
		convexQuery(api.sources.list, { workspaceId, folder: "sub-agents" }),
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
			...(agents ?? []).map((file) => ({
				folder: "sub-agents" as const,
				name: file.replace(/\.ptc$/, ""),
				contentType: null,
			})),
		],
		[knowledge, attachments, agents],
	);
	const toAttachments = useAttachmentUpload(workspaceId);
	const submit = useCallback(
		(text: string, attached: string[]) => {
			const files = attachingFiles(attached);
			const annotations = question ? { ...files, answers: question.id } : files;
			return about
				? sendAbout(about, text, annotations)
				: send(text, annotations);
		},
		[about, question, send, sendAbout],
	);
	const symbols = useSymbols(chatId ?? draftChatId, isLoading);
	const anchor = useAnchor<HTMLDivElement>("composer");

	return (
		<div ref={anchor}>
			<ChatInput
				placeholder={about ? `ask about ${about.path}` : "type a message"}
				onSubmit={submit}
				blocked={blocked}
				files={{ upload: toAttachments.upload, discard: toAttachments.discard }}
				assist={{ mentions, history, onCommand: runCommand, symbols }}
				streaming={{ active: isLoading, onStop: stop }}
				on={inputOn}
				question={question}
			/>
		</div>
	);
}
