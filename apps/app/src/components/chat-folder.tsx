import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { TreeFilter, TreeFolder, TreeMore } from "@repo/components";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNewChat } from "../lib/chats.ts";
import { CHAT_PAGE } from "../lib/sidebar-prefetch.ts";
import { SessionRow } from "./session-row.tsx";
import { type FolderState, Listing } from "./tree-listing.tsx";

const SEARCH_DELAY_MS = 200;

function useSettled(value: string) {
	const [settled, setSettled] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(value), SEARCH_DELAY_MS);
		return () => clearTimeout(timer);
	}, [value]);
	return settled;
}

export function ChatFolder({
	workspaceId,
	folder,
}: {
	workspaceId: Id<"workspaces">;
	folder: FolderState;
}) {
	const newChat = useNewChat();
	const [search, setSearch] = useState("");
	const settled = useSettled(search);
	const [limit, setLimit] = useState(CHAT_PAGE);
	const { data: page } = useQuery({
		...convexQuery(api.chats.list, { workspaceId, search: settled, limit }),
		placeholderData: (previous) => previous,
		enabled: folder.open,
	});

	return (
		<TreeFolder
			{...folder}
			onCreate={() => void newChat()}
			createLabel="new chat"
		>
			<TreeFilter
				value={search}
				onChange={(next) => {
					setSearch(next);
					setLimit(CHAT_PAGE);
				}}
				label="search chats"
			/>
			<Listing
				items={page?.chats}
				empty={settled ? `nothing matches ${settled}` : "no chats yet"}
			>
				{(chat) => <SessionRow key={chat._id} chat={chat} />}
			</Listing>
			{page?.more && (
				<TreeMore onMore={() => setLimit((shown) => shown + CHAT_PAGE)} />
			)}
		</TreeFolder>
	);
}
