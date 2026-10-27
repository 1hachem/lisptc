import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { type FlatLayout, unflatten } from "@repo/components";
import type { QueryClient } from "@tanstack/react-query";
import { knowledgeViewer, readsText, storedTextQuery } from "./file-viewer.ts";
import { type PanelContent, type PanelLayout, shownTabs } from "./panel-ops.ts";
import { panelAt } from "./panel-paths.ts";

type Prefetch<K extends PanelContent["kind"]> = (
	queryClient: QueryClient,
	workspaceId: Id<"workspaces">,
	content: Extract<PanelContent, { kind: K }>,
) => Promise<unknown>;

function prefetchTranscript(
	queryClient: QueryClient,
	chatId: string | null | undefined,
): Promise<unknown> {
	if (chatId === null || chatId === undefined) return Promise.resolve();
	return queryClient.ensureQueryData(
		convexQuery(api.messages.transcript, { chatId: chatId as Id<"chats"> }),
	);
}

const prefetchFile: Prefetch<"file"> = async (
	queryClient,
	workspaceId,
	content,
) => {
	const file = await queryClient.ensureQueryData(
		convexQuery(api.files.get, {
			workspaceId,
			folder: content.folder,
			name: content.name,
		}),
	);
	if (!file?.url || !readsText(knowledgeViewer(file.name, file.contentType)))
		return;
	await queryClient.ensureQueryData(storedTextQuery(file.url));
};

const prefetchPage: Prefetch<"page"> = (queryClient, workspaceId, content) => {
	if (content.page === "memory")
		return queryClient.ensureQueryData(
			convexQuery(api.memories.list, { workspaceId }),
		);
	if (content.page === "bin" && content.id !== undefined)
		return queryClient.ensureQueryData(
			convexQuery(api.bin.get, { workspaceId, name: content.id }),
		);
	return Promise.resolve();
};

function prefetch(
	queryClient: QueryClient,
	workspaceId: Id<"workspaces">,
	content: PanelContent,
): Promise<unknown> {
	if (content.kind === "chat" || content.kind === "view")
		return prefetchTranscript(queryClient, content.chatId);
	if (content.kind === "file")
		return prefetchFile(queryClient, workspaceId, content);
	if (content.kind === "page")
		return prefetchPage(queryClient, workspaceId, content);
	return Promise.resolve();
}

export async function prefetchPanels(
	queryClient: QueryClient,
	workspaceId: Id<"workspaces">,
): Promise<void> {
	const saved = await queryClient
		.ensureQueryData(convexQuery(api.layouts.get, { workspaceId }))
		.catch(() => null);
	if (!saved) return;
	const layout: PanelLayout = unflatten(saved as FlatLayout<PanelContent>);
	await Promise.allSettled(
		shownTabs(layout).map((tab) =>
			prefetch(queryClient, workspaceId, tab.content),
		),
	);
}

export async function prefetchPanelAt(
	queryClient: QueryClient,
	workspaceId: Id<"workspaces">,
	path: string,
): Promise<void> {
	const asked = panelAt(path);
	if (asked === undefined) return;
	await prefetch(queryClient, workspaceId, asked).catch(() => undefined);
}
