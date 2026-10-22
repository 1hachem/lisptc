import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import type { QueryClient } from "@tanstack/react-query";
import { readBoolPref } from "./prefs.ts";

export const CHAT_PAGE = 20;

export function folderCookie(folder: string) {
	return `ui.folder.${folder}`;
}

export function folderOpen(folder: string) {
	return readBoolPref(folderCookie(folder), folder === "chat");
}

export async function prefetchSidebar(
	queryClient: QueryClient,
	workspaceId: Id<"workspaces">,
): Promise<void> {
	await Promise.allSettled([
		queryClient.ensureQueryData(
			convexQuery(api.memories.list, { workspaceId }),
		),
		queryClient.ensureQueryData(
			convexQuery(api.permissions.get, { workspaceId }),
		),
		queryClient.ensureQueryData(
			convexQuery(api.files.list, { workspaceId, folder: "knowledge" }),
		),
		queryClient.ensureQueryData(
			convexQuery(api.files.list, { workspaceId, folder: "attachments" }),
		),
		queryClient.ensureQueryData(
			convexQuery(api.messages.sent, { workspaceId }),
		),
		folderOpen("chat") &&
			queryClient.ensureQueryData(
				convexQuery(api.chats.list, {
					workspaceId,
					search: "",
					limit: CHAT_PAGE,
				}),
			),
		folderOpen("bin") &&
			queryClient.ensureQueryData(convexQuery(api.bin.list, { workspaceId })),
	]);
}
