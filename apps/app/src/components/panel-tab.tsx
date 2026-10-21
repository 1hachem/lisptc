import type { Id } from "@repo/backend/dataModel";
import { type ReactNode, useMemo } from "react";
import { AgentProvider } from "../lib/agent.tsx";
import { ChatProvider, useChatSession } from "../lib/chat.tsx";
import { ForkPickerProvider } from "../lib/fork-picker.tsx";
import { PageHostProvider } from "../lib/page-host.tsx";
import type { PanelContent } from "../lib/panel-ops.ts";
import { PanelLiveOps, usePanels } from "../lib/panels.tsx";
import { toUiNode } from "../lib/ui-node.ts";
import { AccountPage } from "./account-page.tsx";
import { BinPage } from "./bin-page.tsx";
import { Chat } from "./chat.tsx";
import { GenerativeUI } from "./generative-ui.tsx";
import { MemoryPage } from "./memory-page.tsx";
import { PermissionPage } from "./permission-page.tsx";
import { PreferencesPage } from "./preferences-page.tsx";
import { ReadmePage } from "./readme-page.tsx";
import { SettingsPage } from "./settings-page.tsx";
import { FilePreview } from "./stored-file.tsx";

function Column({ children }: { children: ReactNode }) {
	return <div className="flex h-full min-h-0 flex-col">{children}</div>;
}

function ChatTab({
	id,
	workspaceId,
	chatId,
}: {
	id: string;
	workspaceId: Id<"workspaces">;
	chatId: Id<"chats"> | null;
}) {
	const { retab } = usePanels();
	return (
		<ChatProvider
			workspaceId={workspaceId}
			chatId={chatId}
			onOpened={(opened) =>
				retab(id, { kind: "chat", chatId: opened, title: "chat" }, true)
			}
		>
			<ForkPickerProvider
				onForked={(forked) =>
					retab(id, { kind: "chat", chatId: forked, title: "fork" })
				}
			>
				<AgentProvider>
					<PanelLiveOps />
					<Column>
						<Chat />
					</Column>
				</AgentProvider>
			</ForkPickerProvider>
		</ChatProvider>
	);
}

function PageTab({
	workspaceId,
	content,
}: {
	workspaceId: Id<"workspaces">;
	content: Extract<PanelContent, { kind: "page" }>;
}) {
	const id = content.id ?? "";
	switch (content.page) {
		case "memory":
			return <MemoryPage workspaceId={workspaceId} memoryKey={id} />;
		case "permission":
			return <PermissionPage workspaceId={workspaceId} rule={Number(id)} />;
		case "readme":
			return <ReadmePage workspaceId={workspaceId} />;
		case "settings":
			return <SettingsPage workspaceId={workspaceId} />;
		case "preferences":
			return <PreferencesPage />;
		case "account":
			return <AccountPage />;
		case "bin":
			return <BinPage workspaceId={workspaceId} name={id} />;
	}
}

function ViewTab({ node }: { node: unknown }) {
	const drawn = toUiNode(node);
	if (drawn === undefined)
		return <div className="p-3 text-dim">this view cannot be drawn</div>;
	return (
		<div className="p-3">
			<GenerativeUI key={JSON.stringify(drawn)} node={drawn} />
		</div>
	);
}

export function PanelTab({
	id,
	content,
}: {
	id: string;
	content: PanelContent;
}) {
	const workspaceId = useChatSession((state) => state.workspaceId);
	const { retab } = usePanels();
	const host = useMemo(
		() => ({ show: (next: PanelContent) => retab(id, next) }),
		[retab, id],
	);
	return (
		<PageHostProvider host={host}>
			{content.kind === "file" && (
				<FilePreview
					workspaceId={workspaceId}
					folder={content.folder}
					name={content.name}
				/>
			)}
			{content.kind === "view" && <ViewTab node={content.node} />}
			{content.kind === "chat" && (
				<ChatTab
					id={id}
					workspaceId={workspaceId}
					chatId={content.chatId as Id<"chats"> | null}
				/>
			)}
			{content.kind === "page" && (
				<Column>
					<PageTab workspaceId={workspaceId} content={content} />
				</Column>
			)}
		</PageHostProvider>
	);
}
