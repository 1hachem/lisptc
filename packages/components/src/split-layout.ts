export const MAX_SPLITS = 3;

export type Direction = "row" | "column";
export type Edge = "left" | "right" | "top" | "bottom";
export type Placement = "focused" | "right" | "down" | { pane: string };

export interface Tab<T> {
	id: string;
	content: T;
	fixed?: boolean;
}

export interface Pane<T> {
	kind: "pane";
	id: string;
	tabs: Tab<T>[];
	active: string | null;
}

export interface Split<T> {
	kind: "split";
	id: string;
	direction: Direction;
	children: Node<T>[];
	sizes: number[];
}

export type Node<T> = Pane<T> | Split<T>;

export interface SplitLayout<T> {
	root: Node<T> | null;
	focused: string | null;
}

export type Drop =
	| { pane: string; index?: number }
	| { pane: string; edge: Edge }
	| { node: string; edge: Edge };

export function emptyLayout<T>(): SplitLayout<T> {
	return { root: null, focused: null };
}

function nodes<T>(node: Node<T> | null): Node<T>[] {
	if (node === null) return [];
	if (node.kind === "pane") return [node];
	return [node, ...node.children.flatMap((child) => nodes(child))];
}

function panes<T>(layout: SplitLayout<T>): Pane<T>[] {
	return nodes(layout.root).filter((n): n is Pane<T> => n.kind === "pane");
}

export function allTabs<T>(layout: SplitLayout<T>): Tab<T>[] {
	return panes(layout).flatMap((p) => p.tabs);
}

export function vacantPane<T>(layout: SplitLayout<T>): string | undefined {
	return panes(layout).find((p) => p.tabs.length === 0)?.id;
}

export function paneOf<T>(
	layout: SplitLayout<T>,
	tabId: string,
): Pane<T> | undefined {
	return panes(layout).find((p) => p.tabs.some((t) => t.id === tabId));
}

function nextId<T>(
	layout: SplitLayout<T>,
	prefix: "s" | "p",
	also: string[] = [],
): string {
	const taken = new Set([...nodes(layout.root).map((n) => n.id), ...also]);
	let n = 1;
	while (taken.has(`${prefix}${n}`)) n++;
	return `${prefix}${n}`;
}

function even(count: number): number[] {
	return Array.from({ length: count }, () => 100 / count);
}

function mapNode<T>(
	node: Node<T>,
	id: string,
	update: (node: Node<T>) => Node<T>,
): Node<T> {
	if (node.id === id) return update(node);
	if (node.kind === "pane") return node;
	return {
		...node,
		children: node.children.map((child) => mapNode(child, id, update)),
	};
}

function mapPane<T>(
	layout: SplitLayout<T>,
	paneId: string,
	update: (pane: Pane<T>) => Pane<T>,
): SplitLayout<T> {
	if (layout.root === null) return layout;
	return {
		...layout,
		root: mapNode(layout.root, paneId, (n) =>
			n.kind === "pane" ? update(n) : n,
		),
	};
}

function parentOf<T>(node: Node<T> | null, id: string): Split<T> | undefined {
	if (node === null || node.kind === "pane") return undefined;
	if (node.children.some((child) => child.id === id)) return node;
	for (const child of node.children) {
		const found = parentOf(child, id);
		if (found) return found;
	}
	return undefined;
}

function settle<T>(
	node: Node<T>,
	gone: (pane: Pane<T>) => boolean,
): Node<T> | null {
	if (node.kind === "pane") return gone(node) ? null : node;
	const kept = node.children
		.map((child) => settle(child, gone))
		.filter((child): child is Node<T> => child !== null);
	if (kept.length === 0) return null;
	if (kept.length === 1) return kept[0];
	const sizes =
		kept.length === node.children.length ? node.sizes : even(kept.length);
	return { ...node, children: kept, sizes };
}

const emptied = <T>(pane: Pane<T>) => pane.tabs.length === 0;

function prune<T>(
	layout: SplitLayout<T>,
	gone: (pane: Pane<T>) => boolean = emptied,
): SplitLayout<T> {
	const settled = layout.root === null ? null : settle(layout.root, gone);
	const root =
		allTabs({ root: settled, focused: null }).length === 0 ? null : settled;
	const pruned = { ...layout, root };
	const ids = panes(pruned).map((p) => p.id);
	return {
		...pruned,
		focused: ids.includes(layout.focused ?? "")
			? layout.focused
			: (ids[0] ?? null),
	};
}

const keepAll = () => false;

function withTab<T>(pane: Pane<T>, tab: Tab<T>, index?: number): Pane<T> {
	const tabs = pane.tabs.filter((t) => t.id !== tab.id);
	const at = index === undefined ? tabs.length : Math.min(index, tabs.length);
	return {
		...pane,
		tabs: [...tabs.slice(0, at), tab, ...tabs.slice(at)],
		active: tab.id,
	};
}

function withoutTab<T>(pane: Pane<T>, tabId: string): Pane<T> {
	const at = pane.tabs.findIndex((t) => t.id === tabId);
	if (at === -1) return pane;
	const tabs = pane.tabs.filter((t) => t.id !== tabId);
	const active =
		pane.active === tabId
			? (tabs[Math.min(at, tabs.length - 1)]?.id ?? null)
			: pane.active;
	return { ...pane, tabs, active };
}

function focusIn<T>(layout: SplitLayout<T>, paneId: string): SplitLayout<T> {
	return { ...layout, focused: paneId };
}

function freshPane<T>(layout: SplitLayout<T>, tab: Tab<T>): Pane<T> {
	return { kind: "pane", id: nextId(layout, "p"), tabs: [tab], active: tab.id };
}

function full(direction: Direction, count: number): boolean {
	return direction === "column" && count >= MAX_SPLITS;
}

function axisOf(edge: Edge): Direction {
	return edge === "left" || edge === "right" ? "row" : "column";
}

function splitAt<T>(
	layout: SplitLayout<T>,
	nodeId: string,
	edge: Edge,
	tab: Tab<T>,
): SplitLayout<T> {
	if (layout.root === null) return openTab(layout, tab);
	if (!nodes(layout.root).some((n) => n.id === nodeId))
		return openTab(layout, tab);
	const pane = freshPane(layout, tab);
	const after = edge === "right" || edge === "bottom";
	const direction = axisOf(edge);
	const fallback = () => {
		const host = panes(layout).find((p) => p.id === nodeId);
		return openTab(layout, tab, host ? { pane: host.id } : "focused");
	};
	const self = nodes(layout.root).find((n) => n.id === nodeId);
	if (self?.kind === "split" && self.direction === direction) {
		if (full(direction, self.children.length)) return fallback();
		const children = after
			? [...self.children, pane]
			: [pane, ...self.children];
		return {
			root: mapNode(layout.root, self.id, () => ({
				...self,
				children,
				sizes: even(children.length),
			})),
			focused: pane.id,
		};
	}
	const parent = parentOf(layout.root, nodeId);
	if (parent !== undefined && parent.direction === direction) {
		if (full(direction, parent.children.length)) return fallback();
		const at = parent.children.findIndex((c) => c.id === nodeId);
		const children = [...parent.children];
		children.splice(after ? at + 1 : at, 0, pane);
		return {
			root: mapNode(layout.root, parent.id, () => ({
				...parent,
				children,
				sizes: even(children.length),
			})),
			focused: pane.id,
		};
	}
	const splitId = nextId(layout, "s", [pane.id]);
	return {
		root: mapNode(layout.root, nodeId, (node) => ({
			kind: "split",
			id: splitId,
			direction,
			children: after ? [node, pane] : [pane, node],
			sizes: even(2),
		})),
		focused: pane.id,
	};
}

export function focusTab<T>(
	layout: SplitLayout<T>,
	tabId: string,
): SplitLayout<T> {
	const pane = paneOf(layout, tabId);
	if (pane === undefined) return layout;
	return focusIn(
		mapPane(layout, pane.id, (p) => ({ ...p, active: tabId })),
		pane.id,
	);
}

export function openTab<T>(
	layout: SplitLayout<T>,
	tab: Tab<T>,
	placement: Placement = "focused",
): SplitLayout<T> {
	const open = paneOf(layout, tab.id);
	if (open !== undefined)
		return focusTab(
			mapPane(layout, open.id, (p) => ({
				...p,
				tabs: p.tabs.map((t) => (t.id === tab.id ? tab : t)),
			})),
			tab.id,
		);
	const all = panes(layout);
	if (all.length === 0 || layout.root === null) {
		const pane = freshPane(layout, tab);
		return { root: pane, focused: pane.id };
	}
	const focused = all.find((p) => p.id === layout.focused) ?? all[0];
	if (placement === "right") return splitAt(layout, focused.id, "right", tab);
	if (placement === "down") return splitAt(layout, focused.id, "bottom", tab);
	const target =
		placement === "focused"
			? focused
			: (all.find((p) => p.id === placement.pane) ?? focused);
	return focusIn(
		mapPane(layout, target.id, (p) => withTab(p, tab)),
		target.id,
	);
}

export function closeTab<T>(
	layout: SplitLayout<T>,
	tabId: string,
): SplitLayout<T> {
	const pane = paneOf(layout, tabId);
	if (pane === undefined) return layout;
	if (pane.tabs.find((t) => t.id === tabId)?.fixed) return layout;
	return prune(
		mapPane(layout, pane.id, (p) => withoutTab(p, tabId)),
		keepAll,
	);
}

export function closePane<T>(
	layout: SplitLayout<T>,
	paneId: string,
): SplitLayout<T> {
	const pane = panes(layout).find((p) => p.id === paneId);
	if (pane === undefined || pane.tabs.some((t) => t.fixed)) return layout;
	return prune(layout, (p) => p.id === paneId);
}

function lift<T>(layout: SplitLayout<T>, tabId: string): SplitLayout<T> {
	const source = paneOf(layout, tabId);
	if (source === undefined) return layout;
	return prune(
		mapPane(layout, source.id, (p) => withoutTab(p, tabId)),
		(p) => p.id === source.id && emptied(p),
	);
}

function place<T>(
	layout: SplitLayout<T>,
	tab: Tab<T>,
	drop: Drop,
): SplitLayout<T> {
	if ("edge" in drop)
		return splitAt(
			layout,
			"node" in drop ? drop.node : drop.pane,
			drop.edge,
			tab,
		);
	if (!panes(layout).some((p) => p.id === drop.pane))
		return openTab(layout, tab);
	return focusIn(
		mapPane(layout, drop.pane, (p) => withTab(p, tab, drop.index)),
		drop.pane,
	);
}

export function moveTab<T>(
	layout: SplitLayout<T>,
	tabId: string,
	drop: Drop,
): SplitLayout<T> {
	const source = paneOf(layout, tabId);
	if (source === undefined) return layout;
	const tab = source.tabs.find((t) => t.id === tabId) as Tab<T>;
	if ("pane" in drop && !("edge" in drop) && drop.pane === source.id)
		return focusIn(
			mapPane(layout, source.id, (p) => withTab(p, tab, drop.index)),
			source.id,
		);
	const target = "node" in drop ? drop.node : drop.pane;
	if (target === source.id && source.tabs.length === 1) return layout;
	const lifted = lift(layout, tabId);
	if (!nodes(lifted.root).some((n) => n.id === target))
		return "edge" in drop && lifted.root !== null
			? splitAt(lifted, lifted.root.id, drop.edge, tab)
			: openTab(lifted, tab);
	return place(lifted, tab, drop);
}

export function dropTab<T>(
	layout: SplitLayout<T>,
	tab: Tab<T>,
	drop: Drop,
): SplitLayout<T> {
	if (paneOf(layout, tab.id) !== undefined)
		return moveTab(openTab(layout, tab), tab.id, drop);
	return place(layout, tab, drop);
}

export function replaceTab<T>(
	layout: SplitLayout<T>,
	tabId: string,
	tab: Tab<T>,
): SplitLayout<T> {
	if (tabId !== tab.id && paneOf(layout, tab.id) !== undefined)
		return focusTab(
			openTab(
				paneOf(layout, tabId)?.tabs.find((t) => t.id === tabId)?.fixed
					? layout
					: lift(layout, tabId),
				tab,
			),
			tab.id,
		);
	const pane = paneOf(layout, tabId);
	if (pane === undefined) return openTab(layout, tab);
	return focusIn(
		mapPane(layout, pane.id, (p) => ({
			...p,
			tabs: p.tabs.map((t) => (t.id === tabId ? tab : t)),
			active: p.active === tabId ? tab.id : p.active,
		})),
		pane.id,
	);
}

export function joinPane<T>(
	layout: SplitLayout<T>,
	paneId: string,
): SplitLayout<T> {
	const parent = parentOf(layout.root, paneId);
	if (parent === undefined) return layout;
	const at = parent.children.findIndex((c) => c.id === paneId);
	const sibling = parent.children[at - 1] ?? parent.children[at + 1];
	const into = nodes(sibling ?? null).find(
		(n): n is Pane<T> => n.kind === "pane",
	);
	const leaving = panes(layout).find((p) => p.id === paneId);
	if (into === undefined || leaving === undefined) return layout;
	const merged = mapPane(layout, into.id, (p) => ({
		...p,
		tabs: [...p.tabs, ...leaving.tabs],
		active: leaving.active ?? p.active,
	}));
	return prune(
		focusIn(
			mapPane(merged, paneId, (p) => ({ ...p, tabs: [], active: null })),
			into.id,
		),
		(p) => p.id === paneId,
	);
}

export function flip<T>(
	layout: SplitLayout<T>,
	paneId: string,
): SplitLayout<T> {
	const parent = parentOf(layout.root, paneId);
	if (parent === undefined || layout.root === null) return layout;
	return {
		...layout,
		root: mapNode(layout.root, parent.id, () => ({
			...parent,
			direction: parent.direction === "row" ? "column" : "row",
		})),
	};
}

export function resizeSplit<T>(
	layout: SplitLayout<T>,
	splitId: string,
	sizes: Record<string, number>,
): SplitLayout<T> {
	if (layout.root === null) return layout;
	return {
		...layout,
		root: mapNode(layout.root, splitId, (node) =>
			node.kind === "split"
				? {
						...node,
						sizes: node.children.map((c, i) => sizes[c.id] ?? node.sizes[i]),
					}
				: node,
		),
	};
}

export interface FlatPane<T> {
	kind: "pane";
	id: string;
	tabs: Tab<T>[];
	active: string | null;
}

export interface FlatSplit {
	kind: "split";
	id: string;
	direction: Direction;
	children: string[];
	sizes: number[];
}

export interface FlatLayout<T> {
	root: string | null;
	focused: string | null;
	nodes: (FlatPane<T> | FlatSplit)[];
}

export function flatten<T>(layout: SplitLayout<T>): FlatLayout<T> {
	return {
		root: layout.root?.id ?? null,
		focused: layout.focused,
		nodes: nodes(layout.root).map((node) =>
			node.kind === "pane"
				? node
				: { ...node, children: node.children.map((c) => c.id) },
		),
	};
}

export function unflatten<T>(flat: FlatLayout<T>): SplitLayout<T> {
	const byId = new Map(flat.nodes.map((n) => [n.id, n]));
	const build = (id: string, seen: Set<string>): Node<T> | null => {
		const node = byId.get(id);
		if (node === undefined || seen.has(id)) return null;
		const next = new Set(seen).add(id);
		if (node.kind === "pane") return node;
		const children = node.children
			.map((child) => build(child, next))
			.filter((child): child is Node<T> => child !== null);
		return { ...node, children };
	};
	const root = flat.root === null ? null : build(flat.root, new Set());
	return prune({ root, focused: flat.focused }, keepAll);
}
