import {
	PanelRightCloseIcon,
	PanelRightOpenIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Id } from "@repo/backend/dataModel";
import { GlyphCycle } from "@repo/components";
import { Button } from "@repo/ui";
import { anchorOf } from "@repo/ui-catalog";
import { lazy, type ReactNode, Suspense, useMemo } from "react";
import { AgentProvider } from "../lib/agent.tsx";
import { ChatProvider } from "../lib/chat.tsx";
import { ForkPickerProvider } from "../lib/fork-picker.tsx";
import { ClaimLead } from "../lib/lead-chat.tsx";
import { PageHostProvider } from "../lib/page-host.tsx";
import {
	leadChat,
	type Page,
	type PanelContent,
	sideTraceShown,
} from "../lib/panel-ops.ts";
import { usePanels } from "../lib/panels.tsx";
import { useTraceBesideChat } from "../lib/preferences.ts";
import {
	type SideTraceControl,
	SideTraceProvider,
	useSideTrace,
} from "../lib/side-trace.tsx";
import { AccountPage } from "./account-page.tsx";
import { AnimatedFavicon } from "./animated-favicon.tsx";
import { BinPage } from "./bin-page.tsx";
import { ChatSurface } from "./chat-surface.tsx";
import { GenerativeUI } from "./generative-ui.tsx";
import { MemoryPage } from "./memory-page.tsx";
import { PermissionPage } from "./permission-page.tsx";
import { PreferencesPage } from "./preferences-page.tsx";
import { SettingsPage } from "./settings-page.tsx";
import { SourcePage } from "./source-page.tsx";
import { FilePreview } from "./stored-file.tsx";
import { TraceView } from "./trace-view.tsx";

const ReadmePage = lazy(async () => ({
	default: (await import("./readme-page.tsx")).ReadmePage,
}));

function Column({ children }: { children: ReactNode }) {
	return <div className="flex h-full min-h-0 flex-col">{children}</div>;
}

function SideTraceToggle() {
	const control = useSideTrace();
	if (control === null) return null;
	const open = control.trace.shown === "open";
	return (
		<Button
			{...anchorOf("chat/trace")}
			type="button"
			variant="ghost"
			size="icon-sm"
			data-side-trace-toggle
			aria-pressed={open}
			aria-label={open ? "collapse trace" : "open trace"}
			title={open ? "collapse trace" : "open trace"}
			onClick={control.toggle}
			className="absolute top-2 right-2 z-10 text-dim"
		>
			<HugeiconsIcon icon={open ? PanelRightCloseIcon : PanelRightOpenIcon} />
		</Button>
	);
}

function ChatWithTrace({ chatId }: { chatId: Id<"chats"> | null }) {
	const control = useSideTrace();
	const open = chatId !== null && control?.trace.shown === "open";
	return (
		<ChatSurface
			toggle={chatId !== null && <SideTraceToggle />}
			trace={open && <TraceView chatId={chatId} turn={control?.trace.turn} />}
		/>
	);
}

function ChatPane({
	workspaceId,
	chatId,
	lead,
	trace,
	onOpened,
	onForked,
	greetingKey,
}: {
	workspaceId: Id<"workspaces">;
	chatId: Id<"chats"> | null;
	lead: boolean;
	trace: SideTraceControl;
	onOpened: (chatId: Id<"chats">) => void;
	onForked: (chatId: Id<"chats">) => void;
	greetingKey: string;
}) {
	return (
		<ChatProvider
			workspaceId={workspaceId}
			chatId={chatId}
			onOpened={onOpened}
			greetingKey={greetingKey}
		>
			<ForkPickerProvider onForked={onForked}>
				<AgentProvider>
					{lead && (
						<>
							<AnimatedFavicon />
							<ClaimLead />
						</>
					)}
					<SideTraceProvider control={trace}>
						<ChatWithTrace chatId={chatId} />
					</SideTraceProvider>
				</AgentProvider>
			</ForkPickerProvider>
		</ChatProvider>
	);
}

function ChatTab({
	id,
	workspaceId,
	content,
}: {
	id: string;
	workspaceId: Id<"workspaces">;
	content: Extract<PanelContent, { kind: "chat" }>;
}) {
	const { retab, layout } = usePanels();
	const { traceBesideChat } = useTraceBesideChat();
	const trace = useMemo(
		() => sideTraceShown(content.trace, traceBesideChat),
		[content.trace, traceBesideChat],
	);
	const control = useMemo<SideTraceControl>(
		() => ({
			trace,
			show: (turn) =>
				retab(
					id,
					{
						...content,
						trace: { shown: "open", ...(turn === undefined ? {} : { turn }) },
					},
					true,
				),
			toggle: () =>
				retab(
					id,
					{
						...content,
						trace: {
							...trace,
							shown: trace.shown === "open" ? "collapsed" : "open",
						},
					},
					true,
				),
		}),
		[trace, retab, id, content],
	);
	return (
		<ChatPane
			workspaceId={workspaceId}
			chatId={content.chatId as Id<"chats"> | null}
			lead={leadChat(layout) === id}
			greetingKey={id}
			trace={control}
			onOpened={(opened) =>
				retab(id, { ...content, chatId: opened, title: "chat" }, true)
			}
			onForked={(forked) =>
				retab(id, { kind: "chat", chatId: forked, title: "fork" })
			}
		/>
	);
}

const PAGE_TABS: Record<
	Page,
	(workspaceId: Id<"workspaces">, id: string) => ReactNode
> = {
	memory: (workspaceId, id) => (
		<MemoryPage workspaceId={workspaceId} memoryKey={id} />
	),
	permission: (workspaceId, id) => (
		<PermissionPage workspaceId={workspaceId} rule={Number(id)} />
	),
	readme: (workspaceId) => (
		<Suspense
			fallback={
				<div className="flex flex-1 items-center justify-center text-dim">
					<GlyphCycle className="size-icon" />
				</div>
			}
		>
			<ReadmePage workspaceId={workspaceId} />
		</Suspense>
	),
	settings: (workspaceId) => <SettingsPage workspaceId={workspaceId} />,
	preferences: () => <PreferencesPage />,
	account: () => <AccountPage />,
	bin: (workspaceId, id) => <BinPage workspaceId={workspaceId} name={id} />,
};

function PageTab({
	workspaceId,
	content,
}: {
	workspaceId: Id<"workspaces">;
	content: Extract<PanelContent, { kind: "page" }>;
}) {
	return PAGE_TABS[content.page](workspaceId, content.id ?? "");
}

function ViewTab({
	workspaceId,
	viewId,
	chatId,
}: {
	workspaceId: Id<"workspaces">;
	viewId: string;
	chatId: string | undefined;
}) {
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
				<GenerativeUI chatId={chatId as Id<"chats">} viewId={viewId} />
			</div>
		</ChatProvider>
	);
}

function TraceTab({
	workspaceId,
	chatId,
	turn,
}: {
	workspaceId: Id<"workspaces">;
	chatId: string;
	turn: string | undefined;
}) {
	return (
		<ChatProvider
			workspaceId={workspaceId}
			chatId={chatId as Id<"chats">}
			onOpened={() => {}}
		>
			<TraceView chatId={chatId} turn={turn} />
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
			{content.kind === "source" && (
				<SourcePage
					workspaceId={workspaceId}
					folder={content.folder}
					name={content.name}
				/>
			)}
			{content.kind === "view" && (
				<ViewTab
					workspaceId={workspaceId}
					viewId={content.viewId}
					chatId={content.chatId}
				/>
			)}
			{content.kind === "chat" && (
				<ChatTab id={id} workspaceId={workspaceId} content={content} />
			)}
			{content.kind === "trace" && (
				<TraceTab
					workspaceId={workspaceId}
					chatId={content.chatId}
					turn={content.turn}
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
