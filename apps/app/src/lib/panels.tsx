import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import {
	applyPanelOps,
	focusedTab,
	type PanelOp,
} from "@repo/shared/panel-layout";
import {
	allTabs,
	emptyLayout,
	type FlatLayout,
	flatten,
	replaceTab,
	unflatten,
} from "@repo/shared/split-layout";
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
import { reportIssue } from "./analytics.tsx";
import {
	type Folder,
	fileTab,
	type PanelContent,
	type PanelLayout,
	panelTab,
	STARTING_LAYOUT,
} from "./panel-ops.ts";
import { panelAt, panelPath } from "./panel-paths.ts";
import { usePanelRequests } from "./panel-requests.ts";

export interface Panels {
	workspaceId: Id<"workspaces"> | null;
	layout: PanelLayout;
	change: (layout: PanelLayout) => void;
	arrange: (layout: PanelLayout) => void;
	apply: (ops: readonly PanelOp<PanelContent>[]) => void;
	openFile: (folder: Folder, name: string) => void;
	retab: (tabId: string, content: PanelContent, keepId?: boolean) => void;
}

const PanelsContext = createContext<Panels | null>(null);

const NO_PANELS: Panels = {
	workspaceId: null,
	layout: emptyLayout(),
	change: () => {},
	arrange: () => {},
	apply: () => {},
	openFile: () => {},
	retab: () => {},
};

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
	const stored = useMemo<PanelLayout>(() => {
		if (data === undefined) return emptyLayout();
		const saved =
			data === null
				? emptyLayout<PanelContent>()
				: unflatten(data as FlatLayout<PanelContent>);
		return saved.root === null && !arranged ? STARTING_LAYOUT : saved;
	}, [data, arranged]);
	const latest = useRef(stored);
	latest.current = stored;
	const save = useCallback(
		(layout: PanelLayout) => {
			latest.current = layout;
			setArranged(true);
			put({ workspaceId, layout: flatten(layout) }).catch((error) =>
				reportIssue(error, { $exception_source: "panel layout" }),
			);
		},
		[put, workspaceId],
	);
	return {
		layout: stored,
		latest,
		save,
		ready: data !== undefined,
	};
}

function askedFor(layout: PanelLayout, at: string): PanelOp<PanelContent>[] {
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
	apply: (ops: readonly PanelOp<PanelContent>[]) => void,
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
				? { to: "/app/$workspaceId", params: { workspaceId }, replace }
				: {
						to: "/app/$workspaceId/$",
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
	const { layout: stored, latest, save, ready } = usePanelLayout(workspaceId);
	const apply = useCallback(
		(ops: readonly PanelOp<PanelContent>[]) => {
			if (ops.length === 0) return;
			save(applyPanelOps(latest.current, ops));
		},
		[save, latest],
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
	const retab = useCallback(
		(tabId: string, content: PanelContent, keepId = false) => {
			const next = keepId ? { id: tabId, content } : panelTab(content);
			save(replaceTab(latest.current, tabId, next));
		},
		[save, latest],
	);
	const value = useMemo(
		() => ({
			workspaceId,
			layout,
			change: save,
			arrange: save,
			apply,
			openFile,
			retab,
		}),
		[workspaceId, layout, save, apply, openFile, retab],
	);
	return (
		<PanelsContext.Provider value={value}>{children}</PanelsContext.Provider>
	);
}
