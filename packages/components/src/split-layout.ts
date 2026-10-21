export const MAX_SPLITS = 3;

export type Direction = "row" | "column";
export type Edge = "left" | "right" | "top" | "bottom";
export type Placement = "focused" | "right" | "down" | { pane: string };

export interface Tab<T> {
	id: string;
	content: T;
}

export interface Pane<T> {
	id: string;
	size: number;
	tabs: Tab<T>[];
	active: string | null;
}

export interface Group<T> {
	id: string;
	size: number;
	panes: Pane<T>[];
}

export interface SplitLayout<T> {
	direction: Direction;
	groups: Group<T>[];
	focused: string | null;
}

export function emptyLayout<T>(direction: Direction = "row"): SplitLayout<T> {
	return { direction, groups: [], focused: null };
}

export function allTabs<T>(layout: SplitLayout<T>): Tab<T>[] {
	return layout.groups.flatMap((g) => g.panes.flatMap((p) => p.tabs));
}

export function paneOf<T>(
	layout: SplitLayout<T>,
	tabId: string,
): Pane<T> | undefined {
	for (const group of layout.groups)
		for (const pane of group.panes)
			if (pane.tabs.some((t) => t.id === tabId)) return pane;
	return undefined;
}

function panes<T>(layout: SplitLayout<T>): Pane<T>[] {
	return layout.groups.flatMap((g) => g.panes);
}

function nextId<T>(layout: SplitLayout<T>, prefix: "g" | "p"): string {
	const taken = new Set([
		...layout.groups.map((g) => g.id),
		...panes(layout).map((p) => p.id),
	]);
	let n = 1;
	while (taken.has(`${prefix}${n}`)) n++;
	return `${prefix}${n}`;
}

function even<S extends { size: number }>(items: S[]): S[] {
	return items.map((item) => ({ ...item, size: 100 / items.length }));
}

function locate<T>(layout: SplitLayout<T>, paneId: string) {
	const g = layout.groups.findIndex((group) =>
		group.panes.some((p) => p.id === paneId),
	);
	if (g === -1) return undefined;
	return { g, p: layout.groups[g].panes.findIndex((p) => p.id === paneId) };
}

function mapPane<T>(
	layout: SplitLayout<T>,
	paneId: string,
	update: (pane: Pane<T>) => Pane<T>,
): SplitLayout<T> {
	return {
		...layout,
		groups: layout.groups.map((group) => ({
			...group,
			panes: group.panes.map((p) => (p.id === paneId ? update(p) : p)),
		})),
	};
}

function prune<T>(layout: SplitLayout<T>): SplitLayout<T> {
	const groups = layout.groups
		.map((group) => {
			const kept = group.panes.filter((p) => p.tabs.length > 0);
			return kept.length === group.panes.length
				? group
				: { ...group, panes: even(kept) };
		})
		.filter((group) => group.panes.length > 0);
	const pruned = {
		...layout,
		groups: groups.length === layout.groups.length ? groups : even(groups),
	};
	const focused = panes(pruned).some((p) => p.id === layout.focused)
		? layout.focused
		: (panes(pruned)[0]?.id ?? null);
	return { ...pruned, focused };
}

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

function seeded<T>(layout: SplitLayout<T>, tab: Tab<T>): SplitLayout<T> {
	const pane: Pane<T> = {
		id: nextId(layout, "p"),
		size: 100,
		tabs: [tab],
		active: tab.id,
	};
	return {
		...layout,
		groups: [{ id: nextId(layout, "g"), size: 100, panes: [pane] }],
		focused: pane.id,
	};
}

function acrossGroups(direction: Direction, edge: Edge): boolean {
	const horizontal = edge === "left" || edge === "right";
	return direction === "row" ? horizontal : !horizontal;
}

function splitAt<T>(
	layout: SplitLayout<T>,
	paneId: string,
	edge: Edge,
	tab: Tab<T>,
): SplitLayout<T> {
	const at = locate(layout, paneId);
	if (at === undefined) return openTab(layout, tab, "focused");
	const after = edge === "right" || edge === "bottom";
	if (acrossGroups(layout.direction, edge)) {
		if (layout.groups.length >= MAX_SPLITS)
			return focusIn(
				mapPane(layout, paneId, (p) => withTab(p, tab)),
				paneId,
			);
		const pane: Pane<T> = {
			id: nextId(layout, "p"),
			size: 100,
			tabs: [tab],
			active: tab.id,
		};
		const group: Group<T> = { id: nextId(layout, "g"), size: 0, panes: [pane] };
		const groups = [...layout.groups];
		groups.splice(after ? at.g + 1 : at.g, 0, group);
		return { ...layout, groups: even(groups), focused: pane.id };
	}
	const host = layout.groups[at.g];
	if (host.panes.length >= MAX_SPLITS)
		return focusIn(
			mapPane(layout, paneId, (p) => withTab(p, tab)),
			paneId,
		);
	const pane: Pane<T> = {
		id: nextId(layout, "p"),
		size: 0,
		tabs: [tab],
		active: tab.id,
	};
	const list = [...host.panes];
	list.splice(after ? at.p + 1 : at.p, 0, pane);
	return {
		...layout,
		groups: layout.groups.map((g, i) =>
			i === at.g ? { ...g, panes: even(list) } : g,
		),
		focused: pane.id,
	};
}

function focusIn<T>(layout: SplitLayout<T>, paneId: string): SplitLayout<T> {
	return { ...layout, focused: paneId };
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
	if (all.length === 0) return seeded(layout, tab);
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
	return prune(mapPane(layout, pane.id, (p) => withoutTab(p, tabId)));
}

export type Drop =
	| { pane: string; index?: number }
	| { pane: string; edge: Edge };

export function moveTab<T>(
	layout: SplitLayout<T>,
	tabId: string,
	drop: Drop,
): SplitLayout<T> {
	const source = paneOf(layout, tabId);
	if (source === undefined) return layout;
	const tab = source.tabs.find((t) => t.id === tabId) as Tab<T>;
	if ("edge" in drop) {
		if (drop.pane === source.id && source.tabs.length === 1) return layout;
		if (locate(layout, drop.pane) === undefined) return layout;
		const lifted = prune(
			mapPane(layout, source.id, (p) => withoutTab(p, tabId)),
		);
		return splitAt(lifted, drop.pane, drop.edge, tab);
	}
	const lifted =
		drop.pane === source.id
			? layout
			: mapPane(layout, source.id, (p) => withoutTab(p, tabId));
	return prune(
		focusIn(
			mapPane(lifted, drop.pane, (p) => withTab(p, tab, drop.index)),
			drop.pane,
		),
	);
}

export function dropTab<T>(
	layout: SplitLayout<T>,
	tab: Tab<T>,
	drop: Drop,
): SplitLayout<T> {
	if (paneOf(layout, tab.id) !== undefined)
		return moveTab(openTab(layout, tab, { pane: drop.pane }), tab.id, drop);
	if (locate(layout, drop.pane) === undefined) return openTab(layout, tab);
	if ("edge" in drop) return splitAt(layout, drop.pane, drop.edge, tab);
	return focusIn(
		mapPane(layout, drop.pane, (p) => withTab(p, tab, drop.index)),
		drop.pane,
	);
}

export function joinPane<T>(
	layout: SplitLayout<T>,
	paneId: string,
): SplitLayout<T> {
	const at = locate(layout, paneId);
	if (at === undefined) return layout;
	const group = layout.groups[at.g];
	const into =
		group.panes[at.p - 1] ??
		group.panes[at.p + 1] ??
		layout.groups[at.g - 1]?.panes[0] ??
		layout.groups[at.g + 1]?.panes[0];
	if (into === undefined) return layout;
	const leaving = group.panes[at.p];
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
	);
}

export function flip<T>(layout: SplitLayout<T>): SplitLayout<T> {
	return {
		...layout,
		direction: layout.direction === "row" ? "column" : "row",
	};
}

export function resizeGroups<T>(
	layout: SplitLayout<T>,
	sizes: Record<string, number>,
): SplitLayout<T> {
	return {
		...layout,
		groups: layout.groups.map((g) => ({ ...g, size: sizes[g.id] ?? g.size })),
	};
}

export function resizePanes<T>(
	layout: SplitLayout<T>,
	groupId: string,
	sizes: Record<string, number>,
): SplitLayout<T> {
	return {
		...layout,
		groups: layout.groups.map((g) =>
			g.id === groupId
				? {
						...g,
						panes: g.panes.map((p) => ({ ...p, size: sizes[p.id] ?? p.size })),
					}
				: g,
		),
	};
}
