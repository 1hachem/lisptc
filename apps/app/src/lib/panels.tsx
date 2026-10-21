import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { allTabs, emptyLayout, openTab, type Tab } from "@repo/components";
import { useQuery } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from "react";
import type { ChatMessage } from "./chat.tsx";
import { useChatSession } from "./chat.tsx";
import {
	applyPanelOps,
	type Dock,
	type Folder,
	fileTab,
	type PanelContent,
	type PanelLayout,
	type PanelOp,
	toPanelOps,
} from "./panel-ops.ts";

function toolPanel(message: ChatMessage): PanelOp[] {
	return toPanelOps(message.additional_kwargs?.panel);
}

export interface Panels {
	layout: PanelLayout;
	change: (layout: PanelLayout) => void;
	apply: (ops: readonly PanelOp[]) => void;
	openFile: (folder: Folder, name: string) => void;
	dockTab: (tab: Tab<PanelContent>, dock: Dock) => void;
}

const PanelsContext = createContext<Panels | null>(null);

const NO_PANELS: Panels = {
	layout: emptyLayout(),
	change: () => {},
	apply: () => {},
	openFile: () => {},
	dockTab: () => {},
};

export function usePanels(): Panels {
	return useContext(PanelsContext) ?? NO_PANELS;
}

export function hasTabs(layout: PanelLayout): boolean {
	return allTabs(layout).length > 0;
}

function usePanelLayout(workspaceId: Id<"workspaces">) {
	const { data } = useQuery(convexQuery(api.layouts.get, { workspaceId }));
	const mutation = useConvexMutation(api.layouts.put);
	const put = useMemo(
		() =>
			mutation.withOptimisticUpdate((store, args) => {
				store.setQuery(
					api.layouts.get,
					{ workspaceId: args.workspaceId },
					args.layout,
				);
			}),
		[mutation],
	);
	const stored: PanelLayout = data ?? emptyLayout();
	const latest = useRef(stored);
	latest.current = stored;
	const change = useCallback(
		(layout: PanelLayout) => {
			latest.current = layout;
			void put({ workspaceId, layout });
		},
		[put, workspaceId],
	);
	return { layout: stored, latest, change };
}

function useLiveOps(apply: (ops: readonly PanelOp[]) => void) {
	const { messages, isLoading, chatId } = useChatSession((state) => ({
		messages: state.messages,
		isLoading: state.isLoading,
		chatId: state.chatId,
	}));
	const seen = useRef<{ chatId: string | null; ids: Set<string> } | null>(null);
	useEffect(() => {
		const ids = messages.flatMap((m) => (m.id === undefined ? [] : [m.id]));
		if (!isLoading || seen.current?.chatId !== chatId) {
			seen.current = { chatId, ids: new Set(ids) };
			return;
		}
		const known = seen.current.ids;
		const arrived = messages.filter(
			(m) => m.id !== undefined && !known.has(m.id),
		);
		for (const id of ids) known.add(id);
		const ops = arrived.flatMap(toolPanel);
		if (ops.length > 0) apply(ops);
	}, [messages, isLoading, chatId, apply]);
}

export function PanelsProvider({
	workspaceId,
	children,
}: {
	workspaceId: Id<"workspaces">;
	children: ReactNode;
}) {
	const { layout, latest, change } = usePanelLayout(workspaceId);
	const apply = useCallback(
		(ops: readonly PanelOp[]) => {
			if (ops.length > 0) change(applyPanelOps(latest.current, ops));
		},
		[change, latest],
	);
	const openFile = useCallback(
		(folder: Folder, name: string) =>
			apply([
				{
					op: "open",
					tab: fileTab(folder, name),
					split: "here",
					content: { kind: "file", folder, name },
				},
			]),
		[apply],
	);
	const dockTab = useCallback(
		(tab: Tab<PanelContent>, dock: Dock) =>
			change({ ...openTab(latest.current, tab, "focused"), dock }),
		[change, latest],
	);
	useLiveOps(apply);
	const value = useMemo(
		() => ({ layout, change, apply, openFile, dockTab }),
		[layout, change, apply, openFile, dockTab],
	);
	return (
		<PanelsContext.Provider value={value}>{children}</PanelsContext.Provider>
	);
}
