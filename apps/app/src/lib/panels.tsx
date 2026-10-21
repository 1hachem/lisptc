import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import {
	allTabs,
	closeTab,
	emptyLayout,
	type FlatLayout,
	flatten,
	replaceTab,
	type Tab,
	unflatten,
} from "@repo/components";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ChatMessage } from "./chat.tsx";
import { useChatSession } from "./chat.tsx";
import {
	applyPanelOps,
	dockTab,
	type Folder,
	fileTab,
	focusedTab,
	lastChatLeaving,
	type PanelContent,
	type PanelLayout,
	type PanelOp,
	panelTab,
	retireMain,
	STARTING_LAYOUT,
	toPanelOps,
} from "./panel-ops.ts";
import { panelAt, panelPath } from "./panel-paths.ts";
import { usePanelRequests } from "./panel-requests.ts";

function toolPanel(message: ChatMessage, chatId: string | null): PanelOp[] {
	return toPanelOps(message.additional_kwargs?.panel).map((op) =>
		op.op === "open" &&
		op.content.kind === "view" &&
		op.content.chatId === undefined &&
		chatId !== null
			? { ...op, content: { ...op.content, chatId } }
			: op,
	);
}

export type Minimized = readonly Tab<PanelContent>[];

export interface Panels {
	workspaceId: Id<"workspaces"> | null;
	layout: PanelLayout;
	minimized: Minimized;
	change: (layout: PanelLayout) => void;
	arrange: (layout: PanelLayout) => void;
	apply: (ops: readonly PanelOp[]) => void;
	openFile: (folder: Folder, name: string) => void;
	retab: (tabId: string, content: PanelContent, keepId?: boolean) => void;
	minimize: (tabId: string) => void;
	restore: (tabId: string) => void;
	dismiss: (tabId: string) => void;
}

const PanelsContext = createContext<Panels | null>(null);

const NO_PANELS: Panels = {
	workspaceId: null,
	layout: emptyLayout(),
	minimized: [],
	change: () => {},
	arrange: () => {},
	apply: () => {},
	openFile: () => {},
	retab: () => {},
	minimize: () => {},
	restore: () => {},
	dismiss: () => {},
};

const NOTHING_MINIMIZED: Minimized = [];

function without(minimized: Minimized, tabId: string): Minimized {
	return minimized.filter((t) => t.id !== tabId);
}

export function usePanels(): Panels {
	return useContext(PanelsContext) ?? NO_PANELS;
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
	const [arranged, setArranged] = useState(false);
	const minimized = useMemo<Minimized>(
		() => (data?.minimized as Minimized | undefined) ?? NOTHING_MINIMIZED,
		[data],
	);
	const stored = useMemo<PanelLayout>(() => {
		if (data === undefined) return emptyLayout();
		const saved =
			data === null
				? emptyLayout<PanelContent>()
				: retireMain(unflatten(data as FlatLayout<PanelContent>));
		return saved.root === null && minimized.length === 0 && !arranged
			? STARTING_LAYOUT
			: saved;
	}, [data, minimized, arranged]);
	const latest = useRef(stored);
	latest.current = stored;
	const latestMinimized = useRef(minimized);
	latestMinimized.current = minimized;
	const save = useCallback(
		(layout: PanelLayout, held: Minimized) => {
			latest.current = layout;
			latestMinimized.current = held;
			setArranged(true);
			void put({
				workspaceId,
				layout: { ...flatten(layout), minimized: [...held] },
			});
		},
		[put, workspaceId],
	);
	return {
		layout: stored,
		minimized,
		latest,
		latestMinimized,
		save,
		ready: data !== undefined,
	};
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
		const ops = arrived.flatMap((m) => toolPanel(m, chatId));
		if (ops.length > 0) apply(ops);
	}, [messages, isLoading, chatId, apply]);
}

export function PanelLiveOps() {
	const { apply } = usePanels();
	useLiveOps(apply);
	return null;
}

function askedFor(layout: PanelLayout, at: string): PanelOp[] {
	const asked = at === "" ? undefined : panelAt(at);
	if (asked === undefined) return [];
	const focused = focusedTab(layout);
	if (focused !== undefined && panelPath(focused.content) === at) return [];
	return [
		{ op: "open", tab: panelTab(asked).id, split: "here", content: asked },
	];
}

function useUrlFocus(
	workspaceId: Id<"workspaces">,
	stored: PanelLayout,
	ready: boolean,
	apply: (ops: readonly PanelOp[]) => void,
): PanelLayout {
	const navigate = useNavigate();
	const at = useParams({ strict: false })._splat ?? "";
	const [synced, setSynced] = useState<string | null>(null);
	const asking = ready && synced !== at ? askedFor(stored, at) : [];
	const layout = asking.length > 0 ? applyPanelOps(stored, asking) : stored;
	const known = useRef<Set<string> | null>(null);
	useEffect(() => {
		if (!ready) return;
		if (at !== synced) {
			setSynced(at);
			const ops = askedFor(stored, at);
			if (ops.length > 0) {
				apply(ops);
				return;
			}
		}
		const before = known.current;
		known.current = new Set(allTabs(stored).map((t) => t.id));
		const focused = focusedTab(stored);
		const shown =
			focused === undefined ? undefined : panelPath(focused.content);
		if (shown === undefined || shown === at) return;
		const replace = focused === undefined || before?.has(focused.id) !== false;
		void navigate(
			shown === ""
				? { to: "/$workspaceId", params: { workspaceId }, replace }
				: {
						to: "/$workspaceId/$",
						params: { workspaceId, _splat: shown },
						replace,
					},
		);
	}, [ready, at, synced, stored, apply, navigate, workspaceId]);
	return layout;
}

export function PanelsProvider({
	workspaceId,
	children,
}: {
	workspaceId: Id<"workspaces">;
	children: ReactNode;
}) {
	const {
		layout: stored,
		minimized,
		latest,
		latestMinimized,
		save,
		ready,
	} = usePanelLayout(workspaceId);
	const change = useCallback(
		(layout: PanelLayout) => save(layout, latestMinimized.current),
		[save, latestMinimized],
	);
	const arrange = useCallback(
		(layout: PanelLayout) => {
			const held = latestMinimized.current;
			const leaving = lastChatLeaving(latest.current, layout, held);
			save(layout, leaving === undefined ? held : [...held, leaving]);
		},
		[save, latest, latestMinimized],
	);
	const apply = useCallback(
		(ops: readonly PanelOp[]) => {
			if (ops.length === 0) return;
			const touched = new Set(ops.map((op) => op.tab));
			save(
				applyPanelOps(latest.current, ops),
				latestMinimized.current.filter((t) => !touched.has(t.id)),
			);
		},
		[save, latest, latestMinimized],
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
	usePanelRequests(apply);
	const layout = useUrlFocus(workspaceId, stored, ready, apply);
	const minimize = useCallback(
		(tabId: string) => {
			const tab = allTabs(latest.current).find((t) => t.id === tabId);
			if (tab === undefined || tab.fixed) return;
			save(closeTab(latest.current, tabId), [
				...without(latestMinimized.current, tabId),
				tab,
			]);
		},
		[save, latest, latestMinimized],
	);
	const restore = useCallback(
		(tabId: string) => {
			const tab = latestMinimized.current.find((t) => t.id === tabId);
			if (tab === undefined) return;
			save(
				dockTab(latest.current, tab),
				without(latestMinimized.current, tabId),
			);
		},
		[save, latest, latestMinimized],
	);
	const dismiss = useCallback(
		(tabId: string) =>
			save(latest.current, without(latestMinimized.current, tabId)),
		[save, latest, latestMinimized],
	);
	const retab = useCallback(
		(tabId: string, content: PanelContent, keepId = false) => {
			const next = keepId ? { id: tabId, content } : panelTab(content);
			const held = latestMinimized.current;
			if (held.some((t) => t.id === tabId))
				return save(
					latest.current,
					held.map((t) => (t.id === tabId ? next : t)),
				);
			change(replaceTab(latest.current, tabId, next));
		},
		[save, change, latest, latestMinimized],
	);
	const value = useMemo(
		() => ({
			workspaceId,
			layout,
			minimized,
			change,
			arrange,
			apply,
			openFile,
			retab,
			minimize,
			restore,
			dismiss,
		}),
		[
			workspaceId,
			layout,
			minimized,
			change,
			arrange,
			apply,
			openFile,
			retab,
			minimize,
			restore,
			dismiss,
		],
	);
	return (
		<PanelsContext.Provider value={value}>{children}</PanelsContext.Provider>
	);
}
