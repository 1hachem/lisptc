import type { Id } from "@repo/backend/dataModel";
import { type ReactNode, useMemo } from "react";
import { AgentProvider } from "../lib/agent.tsx";
import { ChatProvider } from "../lib/chat.tsx";
import { ForkPickerProvider } from "../lib/fork-picker.tsx";
import { ClaimLead } from "../lib/lead-chat.tsx";
import { PageHostProvider } from "../lib/page-host.tsx";
import { leadChat, type PanelContent } from "../lib/panel-ops.ts";
import { PanelLiveOps, usePanels } from "../lib/panels.tsx";
import { toUiNode } from "../lib/ui-node.ts";
import { AccountPage } from "./account-page.tsx";
import { AnimatedFavicon } from "./animated-favicon.tsx";
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

function ChatPane({
	workspaceId,
	chatId,
	lead,
	onOpened,
	onForked,
}: {
	workspaceId: Id<"workspaces">;
	chatId: Id<"chats"> | null;
	lead: boolean;
	onOpened: (chatId: Id<"chats">) => void;
	onForked: (chatId: Id<"chats">) => void;
}) {
	return (
		<ChatProvider workspaceId={workspaceId} chatId={chatId} onOpened={onOpened}>
			<ForkPickerProvider onForked={onForked}>
				<AgentProvider>
					{lead && (
						<>
							<AnimatedFavicon />
							<ClaimLead />
						</>
					)}
					<PanelLiveOps />
					<Column>
						<Chat />
					</Column>
				</AgentProvider>
			</ForkPickerProvider>
		</ChatProvider>
	);
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
	const { retab, layout, minimized } = usePanels();
	return (
		<ChatPane
			workspaceId={workspaceId}
			chatId={chatId}
			lead={leadChat(layout, minimized) === id}
			onOpened={(opened) =>
				retab(id, { kind: "chat", chatId: opened, title: "chat" }, true)
			}
			onForked={(forked) =>
				retab(id, { kind: "chat", chatId: forked, title: "fork" })
			}
		/>
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

function ViewTab({
	workspaceId,
	node,
	chatId,
}: {
	workspaceId: Id<"workspaces">;
	node: unknown;
	chatId: string | undefined;
}) {
	const drawn = toUiNode(node);
	if (drawn === undefined)
		return <div className="p-3 text-dim">this view cannot be drawn</div>;
	if (chatId === undefined)
		return (
			<div className="p-3 text-dim">
				this view is no longer live — ask again to rebuild it
			</div>
		);
	return (
		<ChatProvider
			workspaceId={workspaceId}
			chatId={chatId as Id<"chats">}
			onOpened={() => {}}
		>
			<div className="p-3">
				<GenerativeUI key={JSON.stringify(drawn)} node={drawn} />
			</div>
		</ChatProvider>
	);
}

export function PanelTab({
	id,
	content,
}: {
	id: string;
	content: PanelContent;
}) {
	const { retab, workspaceId: panelsWorkspace } = usePanels();
	const workspaceId = panelsWorkspace as Id<"workspaces">;
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
			{content.kind === "view" && (
				<ViewTab
					workspaceId={workspaceId}
					node={content.node}
					chatId={content.chatId}
				/>
			)}
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
