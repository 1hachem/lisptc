import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { type FlatLayout, unflatten } from "@repo/components";
import type { QueryClient } from "@tanstack/react-query";
import {
	type PanelContent,
	type PanelLayout,
	retireMain,
	shownTabs,
} from "./panel-ops.ts";

function prefetch(
	queryClient: QueryClient,
	workspaceId: Id<"workspaces">,
	content: PanelContent,
): Promise<unknown> {
	switch (content.kind) {
		case "chat":
			return content.chatId === null
				? Promise.resolve()
				: queryClient.ensureQueryData(
						convexQuery(api.messages.transcript, {
							chatId: content.chatId as Id<"chats">,
						}),
					);
		case "file":
			return queryClient.ensureQueryData(
				convexQuery(
					content.folder === "knowledge"
						? api.knowledge.get
						: api.attachments.get,
					{ workspaceId, name: content.name },
				),
			);
		case "page":
			if (content.page === "memory")
				return queryClient.ensureQueryData(
					convexQuery(api.memories.list, { workspaceId }),
				);
			if (content.page === "bin" && content.id !== undefined)
				return queryClient.ensureQueryData(
					convexQuery(api.bin.get, { workspaceId, name: content.id }),
				);
			return Promise.resolve();
		case "view":
			return Promise.resolve();
	}
}

export async function prefetchPanels(
	queryClient: QueryClient,
	workspaceId: Id<"workspaces">,
): Promise<void> {
	const saved = await queryClient
		.ensureQueryData(convexQuery(api.layouts.get, { workspaceId }))
		.catch(() => null);
	if (!saved) return;
	const layout: PanelLayout = retireMain(
		unflatten(saved as FlatLayout<PanelContent>),
	);
	await Promise.allSettled(
		shownTabs(layout).map((tab) =>
			prefetch(queryClient, workspaceId, tab.content),
		),
	);
}
