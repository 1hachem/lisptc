"use client";

import {
	ArrowLeftRightIcon,
	ArrowUpDownIcon,
	Cancel01Icon,
	DragDropIcon,
	LayoutTwoColumnIcon,
	LayoutTwoRowIcon,
	Minimize01Icon,
	MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	allTabs,
	closePane,
	closeTab,
	type Direction,
	type Drop,
	dropTab,
	type Edge,
	flip,
	focusTab,
	joinPane,
	moveTab,
	type Node,
	type Pane,
	resizeSplit,
	type SplitLayout,
	type Tab,
} from "@repo/shared/split-layout";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@repo/ui";
import {
	type ComponentProps,
	type ReactNode,
	type Ref,
	type RefObject,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import {
	type Carried,
	type DropSpot,
	type Rect,
	rectOf,
	useCarried,
	useDragSource,
	useDropSpots,
} from "./drag-layer.tsx";

const ZOOMS_IN =
	"group-data-[animated=true]/split:animate-zoom-in motion-reduce:animate-none";
const SLIDES_IN =
	"group-data-[animated=true]/split:animate-slide-in motion-reduce:animate-none";
const SLIDES_SHORT =
	"group-data-[animated=true]/split:animate-slide-short motion-reduce:animate-none";
const EDGE_BAND = 0.25;
const VIEW_EDGE_PX = 12;
const MARK_PX = 2;
type GroupHandle =
	NonNullable<
		ComponentProps<typeof ResizablePanelGroup>["groupRef"]
	> extends Ref<infer Handle>
		? Handle
		: never;

const MIN_SPLIT = "12%";
const VISIBLE_COLUMNS = 2;
const PAGE_AFTER = 0.2;
const GESTURE_IDLE_MS = 220;
const COAST_STEPS = 3;
const EDGES: Edge[] = ["left", "right", "top", "bottom"];
type Axis = "width" | "height";

interface Maximized {
	pane: string;
	axis: Axis;
}

const AXIS_OF: Record<"row" | "column", Axis> = {
	row: "width",
	column: "height",
};

export interface SplitViewProps<T> {
	layout: SplitLayout<T>;
	onChange: (layout: SplitLayout<T>) => void;
	renderTab: (content: T, id: string) => ReactNode;
	tabLabel: (content: T) => string;
	animated?: boolean;
	placeholder?: ReactNode;
	external?: {
		kind: string;
		read: (payload: unknown) => Tab<T> | undefined;
	};
	footer?: (indicator: ReactNode) => ReactNode;
	minWidth?: (content: T) => number;
}

export function SplitView<T>({
	layout,
	onChange,
	renderTab,
	tabLabel,
	animated = false,
	placeholder,
	external,
	footer,
	minWidth,
}: SplitViewProps<T>) {
	const { moved, entrance } = useEntrance(layout);
	const tabKind = `tabs${useId()}`;
	const stage = useRef<HTMLDivElement>(null);
	const carried = useCarried();
	const dragging =
		carried !== null &&
		(carried.kind === tabKind || carried.kind === external?.kind);
	const [live, setLive] = useState<{ layout: SplitLayout<T>; tab: string }>();
	useDropSpots((held) => {
		const tab = tabCarried(held, tabKind, layout, external);
		if (!tab || !stage.current) return [];
		const landed = (drop: Drop) =>
			tab.moving
				? moveTab(layout, tab.tab.id, drop)
				: dropTab(layout, tab.tab, drop);
		return splitSpots(
			stage.current,
			layout,
			(drop) => {
				setLive(undefined);
				if (tab.moving) moved.current = tab.tab.id;
				onChange(landed(drop));
			},
			(drop) => setLive(drop && { layout: landed(drop), tab: tab.tab.id }),
		);
	});
	const shown = live?.layout ?? layout;
	const pager = usePagedScroll(shown.root !== null);
	const [held, maximize] = useState<Maximized | null>(null);
	const maximized =
		held !== null && paneIds(shown.root).includes(held.pane) ? held : null;
	const view = {
		layout: shown,
		previewing: live?.tab,
		dragging,
		tabKind,
		onChange,
		renderTab,
		tabLabel,
		entrance,
		maximized,
		maximize,
		minWidth,
	};
	return (
		<div className="flex h-full min-h-0 flex-col">
			<Stage
				stage={stage}
				layout={shown}
				view={view}
				pager={pager}
				animated={animated}
				placeholder={placeholder}
			/>
			{footer?.(<PageIndicator layout={shown} pager={pager} />)}
		</div>
	);
}

function tabCarried<T>(
	carried: Carried,
	tabKind: string,
	layout: SplitLayout<T>,
	external: SplitViewProps<T>["external"],
): { tab: Tab<T>; moving: boolean } | undefined {
	if (carried.kind === tabKind) {
		const tab = allTabs(layout).find((t) => t.id === carried.payload);
		return tab && { tab, moving: true };
	}
	if (external && carried.kind === external.kind) {
		const tab = external.read(carried.payload);
		return tab && { tab, moving: false };
	}
	return undefined;
}

function clipped(rect: Rect, to: Rect): Rect {
	const left = Math.max(rect.left, to.left);
	const top = Math.max(rect.top, to.top);
	const right = Math.min(rect.left + rect.width, to.left + to.width);
	const bottom = Math.min(rect.top + rect.height, to.top + to.height);
	return {
		left,
		top,
		width: Math.max(0, right - left),
		height: Math.max(0, bottom - top),
	};
}

function edgeOf(rect: Rect, edge: Edge, depth: number): Rect {
	switch (edge) {
		case "left":
			return { ...rect, width: depth };
		case "right":
			return { ...rect, left: rect.left + rect.width - depth, width: depth };
		case "top":
			return { ...rect, height: depth };
		case "bottom":
			return { ...rect, top: rect.top + rect.height - depth, height: depth };
	}
}

function halfOf(rect: Rect, edge: Edge): Rect {
	const across = edge === "left" || edge === "right";
	return edgeOf(rect, edge, (across ? rect.width : rect.height) / 2);
}

function bandOf(rect: Rect, edge: Edge): Rect {
	const across = edge === "left" || edge === "right";
	return edgeOf(rect, edge, (across ? rect.width : rect.height) * EDGE_BAND);
}

function middleOf(rect: Rect): Rect {
	return {
		left: rect.left + rect.width * EDGE_BAND,
		top: rect.top + rect.height * EDGE_BAND,
		width: rect.width * (1 - 2 * EDGE_BAND),
		height: rect.height * (1 - 2 * EDGE_BAND),
	};
}

export function splitSpots<T>(
	stage: Element,
	layout: SplitLayout<T>,
	drop: (drop: Drop) => void,
	preview?: (drop: Drop | undefined) => void,
): DropSpot[] {
	const landing = (hit: Rect, shows: Rect, at: Drop): DropSpot =>
		preview
			? {
					hit,
					enter: () => preview(at),
					leave: () => preview(undefined),
					drop: () => drop(at),
				}
			: { hit, shows, drop: () => drop(at) };
	const area = rectOf(stage);
	const root = layout.root;
	if (!root) return [landing(area, area, { pane: "" })];
	const view = EDGES.map((edge) =>
		landing(edgeOf(area, edge, VIEW_EDGE_PX), halfOf(area, edge), {
			node: root.id,
			edge,
		}),
	);
	const slots = [...stage.querySelectorAll("[data-tab-slot]")].map(
		(slot): DropSpot => {
			const rect = clipped(rectOf(slot), area);
			const pane = slot.getAttribute("data-pane") ?? "";
			const index = Number(slot.getAttribute("data-tab-slot"));
			return landing(
				rect,
				{ ...rect, left: rect.left - MARK_PX / 2, width: MARK_PX },
				{ pane, index },
			);
		},
	);
	const bodies = [...stage.querySelectorAll("[data-pane-body]")].map(
		(body) => ({
			pane: body.getAttribute("data-pane-body") ?? "",
			rect: clipped(rectOf(body), area),
		}),
	);
	const edges = bodies.flatMap(({ pane, rect }) =>
		EDGES.map((edge) =>
			landing(bandOf(rect, edge), halfOf(rect, edge), { pane, edge }),
		),
	);
	const centers = bodies.map(({ pane, rect }) =>
		landing(middleOf(rect), rect, { pane }),
	);
	return [...view, ...slots, ...edges, ...centers].filter(
		(spot) => spot.hit.width > 0 && spot.hit.height > 0,
	);
}

function useEntrance<T>(layout: SplitLayout<T>) {
	const known = useRef(new Set(paneIds(layout.root)));
	const moved = useRef<string | null>(null);
	useEffect(() => {
		known.current = new Set(paneIds(layout.root));
		moved.current = null;
	}, [layout]);
	const entrance = (pane: Pane<T>) => {
		if (known.current.has(pane.id)) return "";
		return pane.tabs.some((t) => t.id === moved.current) ? SLIDES_IN : ZOOMS_IN;
	};
	return { moved, entrance };
}

function Stage<T>({
	stage,
	layout,
	view,
	pager,
	animated,
	placeholder,
}: {
	stage: RefObject<HTMLDivElement | null>;
	layout: SplitLayout<T>;
	view: View<T>;
	pager: RefObject<HTMLDivElement | null>;
	animated: boolean;
	placeholder: ReactNode;
}) {
	return (
		<div
			ref={stage}
			data-animated={animated}
			className="group/split relative min-h-0 flex-1"
		>
			{layout.root ? (
				<div ref={pager} className="h-full overflow-hidden overscroll-x-none">
					<NodeView node={layout.root} view={view} root />
				</div>
			) : (
				<div className="flex h-full items-center justify-center">
					{placeholder}
				</div>
			)}
		</div>
	);
}

export function pagedStop(
	stops: readonly number[],
	settled: number,
	travelled: number,
	after = PAGE_AFTER,
): number {
	if (travelled === 0) return settled;
	const next = settled + Math.sign(travelled);
	const from = stops[settled];
	const to = stops[next];
	if (from === undefined || to === undefined) return settled;
	return Math.abs(travelled) >= after * Math.abs(to - from) ? next : settled;
}

function stopsOf(scroller: HTMLElement): number[] {
	const max = scroller.scrollWidth - scroller.clientWidth;
	const origin = scroller.getBoundingClientRect().left - scroller.scrollLeft;
	const panels = scroller.querySelectorAll(
		':scope > [data-slot="resizable-panel-group"] > [data-slot="resizable-panel"]',
	);
	const starts = [...panels]
		.map((panel) => panel.getBoundingClientRect().left - origin)
		.filter((start) => start < max - 1);
	return [...starts, max];
}

function nearest(stops: readonly number[], at: number): number {
	let best = 0;
	stops.forEach((stop, i) => {
		if (Math.abs(stop - at) < Math.abs((stops[best] ?? 0) - at)) best = i;
	});
	return best;
}

function scrollsItself(
	from: EventTarget | null,
	scroller: HTMLElement,
	dx: number,
): boolean {
	for (
		let at = from instanceof HTMLElement ? from : null;
		at && at !== scroller;
		at = at.parentElement
	) {
		if (at.scrollWidth <= at.clientWidth) continue;
		const room =
			dx > 0 ? at.scrollWidth - at.clientWidth - at.scrollLeft : at.scrollLeft;
		if (room > 0 && getComputedStyle(at).overflowX !== "hidden") return true;
	}
	return false;
}

function usePagedScroll(shown: boolean) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const scroller = ref.current;
		if (!shown || !scroller) return;
		let gesture: {
			stops: number[];
			settled: number;
			travelled: number;
			released: boolean;
			peak: number;
			last: number;
			fading: number;
		} | null = null;
		let idle: ReturnType<typeof setTimeout> | undefined;
		const release = () => {
			if (gesture === null || gesture.released) return;
			gesture.released = true;
			const target = pagedStop(
				gesture.stops,
				gesture.settled,
				gesture.travelled,
			);
			scroller.scrollTo({
				left: gesture.stops[target] ?? 0,
				behavior: "smooth",
			});
		};
		const finish = () => {
			release();
			gesture = null;
		};
		const follow = (dx: number) => {
			if (gesture === null) {
				const stops = stopsOf(scroller);
				gesture = {
					stops,
					settled: nearest(stops, scroller.scrollLeft),
					travelled: 0,
					released: false,
					peak: 0,
					last: 0,
					fading: 0,
				};
			}
			if (gesture.released) return;
			const { stops, settled } = gesture;
			const base = stops[settled] ?? 0;
			const back = base - (stops[settled - 1] ?? base);
			const ahead = (stops[settled + 1] ?? base) - base;
			gesture.travelled = Math.min(
				ahead,
				Math.max(-back, gesture.travelled + dx),
			);
			scroller.scrollLeft = base + gesture.travelled;
		};
		const coasting = (dx: number) => {
			if (gesture === null) return false;
			const size = Math.abs(dx);
			gesture.fading = size < gesture.last ? gesture.fading + 1 : 0;
			gesture.last = size;
			gesture.peak = Math.max(gesture.peak, size);
			return gesture.fading >= COAST_STEPS && size < gesture.peak / 2;
		};
		const onWheel = (event: WheelEvent) => {
			const dx =
				event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
			if (Math.abs(dx) <= Math.abs(event.shiftKey ? 0 : event.deltaY)) return;
			if (scroller.scrollWidth <= scroller.clientWidth) return;
			if (gesture === null && scrollsItself(event.target, scroller, dx)) return;
			event.preventDefault();
			follow(dx);
			if (coasting(dx)) release();
			clearTimeout(idle);
			idle = setTimeout(finish, GESTURE_IDLE_MS);
		};
		let touch: { x: number; y: number; sideways: boolean | null } | null = null;
		const onTouchStart = (event: TouchEvent) => {
			const point = event.touches[0];
			if (event.touches.length === 1 && point)
				touch = { x: point.clientX, y: point.clientY, sideways: null };
		};
		const onTouchMove = (event: TouchEvent) => {
			const point = event.touches[0];
			if (!touch || !point) return;
			const dx = touch.x - point.clientX;
			const dy = touch.y - point.clientY;
			touch.sideways ??= Math.abs(dx) > Math.abs(dy);
			if (!touch.sideways || scroller.scrollWidth <= scroller.clientWidth)
				return;
			event.preventDefault();
			touch.x = point.clientX;
			touch.y = point.clientY;
			follow(dx);
		};
		const onTouchEnd = () => {
			if (touch?.sideways) finish();
			touch = null;
		};
		scroller.addEventListener("wheel", onWheel, { passive: false });
		scroller.addEventListener("touchstart", onTouchStart, { passive: true });
		scroller.addEventListener("touchmove", onTouchMove, { passive: false });
		scroller.addEventListener("touchend", onTouchEnd);
		scroller.addEventListener("touchcancel", onTouchEnd);
		return () => {
			clearTimeout(idle);
			scroller.removeEventListener("wheel", onWheel);
			scroller.removeEventListener("touchstart", onTouchStart);
			scroller.removeEventListener("touchmove", onTouchMove);
			scroller.removeEventListener("touchend", onTouchEnd);
			scroller.removeEventListener("touchcancel", onTouchEnd);
		};
	}, [shown]);
	return ref;
}

interface View<T> {
	layout: SplitLayout<T>;
	previewing: string | undefined;
	dragging: boolean;
	tabKind: string;
	onChange: (layout: SplitLayout<T>) => void;
	renderTab: (content: T, id: string) => ReactNode;
	tabLabel: (content: T) => string;
	entrance: (pane: Pane<T>) => string;
	maximized: Maximized | null;
	maximize: (maximized: Maximized | null) => void;
	minWidth: ((content: T) => number) | undefined;
}

function useColumnsInView(
	pager: RefObject<HTMLDivElement | null>,
	count: number,
): readonly number[] {
	const [seen, setSeen] = useState<readonly number[]>([]);
	useEffect(() => {
		const scroller = pager.current;
		if (!scroller || count === 0) return;
		let frame = 0;
		const measure = () => {
			frame = 0;
			const view = scroller.getBoundingClientRect();
			const panels = scroller.querySelectorAll(
				':scope > [data-slot="resizable-panel-group"] > [data-slot="resizable-panel"]',
			);
			const inView = [...panels].flatMap((panel, i) => {
				const box = panel.getBoundingClientRect();
				const overlap =
					Math.min(box.right, view.right) - Math.max(box.left, view.left);
				return box.width > 0 && overlap >= box.width / 2 ? [i] : [];
			});
			setSeen((held) => (held.join() === inView.join() ? held : inView));
		};
		const soon = () => {
			if (frame === 0) frame = requestAnimationFrame(measure);
		};
		measure();
		scroller.addEventListener("scroll", soon, { passive: true });
		const watch =
			typeof ResizeObserver === "undefined" ? null : new ResizeObserver(soon);
		watch?.observe(scroller);
		return () => {
			cancelAnimationFrame(frame);
			scroller.removeEventListener("scroll", soon);
			watch?.disconnect();
		};
	}, [pager, count]);
	return seen;
}

function PageIndicator<T>({
	layout,
	pager,
}: {
	layout: SplitLayout<T>;
	pager: RefObject<HTMLDivElement | null>;
}) {
	const root = layout.root;
	const columns =
		root?.kind === "split" && root.direction === "row" ? root.children : [];
	const seen = useColumnsInView(pager, columns.length);
	if (columns.length < 2) return null;
	const active = columns.findIndex((c) =>
		paneIds(c).includes(layout.focused ?? ""),
	);
	const show = (i: number) => {
		const scroller = pager.current;
		const panel = scroller?.querySelectorAll<HTMLElement>(
			':scope > [data-slot="resizable-panel-group"] > [data-slot="resizable-panel"]',
		)[i];
		if (!scroller || !panel) return;
		const left =
			panel.getBoundingClientRect().left -
			scroller.getBoundingClientRect().left +
			scroller.scrollLeft;
		scroller.scrollTo({ left, behavior: "smooth" });
	};
	return (
		<nav aria-label="panes" className="flex h-full items-center gap-1 px-2">
			{columns.map((column, i) => (
				<button
					key={column.id}
					type="button"
					aria-label={`pane ${i + 1} of ${columns.length}`}
					aria-current={i === active ? "true" : undefined}
					data-in-view={seen.includes(i)}
					onClick={() => show(i)}
					className={`h-1.5 cursor-pointer rounded-full transition-all ${seen.includes(i) ? "w-3" : "w-1.5"} ${i === active ? "bg-accent" : seen.includes(i) ? "bg-fg/60" : "bg-dim/40 hover:bg-dim"}`}
				/>
			))}
		</nav>
	);
}

function axesAround<T>(node: Node<T> | null, paneId: string): Axis[] {
	if (node === null || node.kind === "pane") return [];
	const inside = node.children.find((child) => paneIds(child).includes(paneId));
	if (inside === undefined) return [];
	return [AXIS_OF[node.direction], ...axesAround(inside, paneId)];
}

function paneIds<T>(node: Node<T> | null): string[] {
	if (node === null) return [];
	if (node.kind === "pane") return [node.id];
	return node.children.flatMap((child) => paneIds(child));
}

export function widthFloor<T>(
	node: Node<T>,
	minWidth: (content: T) => number,
): number {
	if (node.kind === "pane")
		return Math.max(0, ...node.tabs.map((tab) => minWidth(tab.content)));
	const floors = node.children.map((child) => widthFloor(child, minWidth));
	return node.direction === "row"
		? floors.reduce((sum, floor) => sum + floor, 0)
		: Math.max(0, ...floors);
}

function widened<T>(
	node: Node<T>,
	root: boolean,
	maximized: Maximized | null,
): number {
	if (!root || node.kind !== "split" || node.direction !== "row") return -1;
	if (maximized?.axis !== "width") return -1;
	return node.children.findIndex((child) =>
		paneIds(child).includes(maximized.pane),
	);
}

function NodeView<T>({
	node,
	view,
	root = false,
}: {
	node: Node<T>;
	view: View<T>;
	root?: boolean;
}) {
	if (node.kind === "pane") return <PaneView pane={node} {...view} />;
	const { maximized } = view;
	const kept =
		maximized !== null && AXIS_OF[node.direction] === maximized.axis
			? node.children.find((child) => paneIds(child).includes(maximized.pane))
			: undefined;
	if (kept !== undefined && widened(node, root, maximized) === -1)
		return (
			<div className="h-full w-full">
				<NodeView node={kept} view={view} />
			</div>
		);
	return <GroupView split={node} view={view} root={root} />;
}

function GroupView<T>({
	split,
	view,
	root,
}: {
	split: Extract<Node<T>, { kind: "split" }>;
	view: View<T>;
	root: boolean;
}) {
	const group = useRef<GroupHandle | null>(null);
	const count = split.children.length;
	const wide = widened(split, root, view.maximized);
	const screens =
		wide === -1
			? Math.max(1, count / VISIBLE_COLUMNS)
			: 1 + (count - 1) / VISIBLE_COLUMNS;
	const scrolls = root && split.direction === "row" && screens > 1;
	const widest = scrolls ? 100 / screens : undefined;
	useEffect(() => {
		const handle = group.current;
		if (!handle || !scrolls) return;
		const share = 100 / screens;
		const rest = count > 1 ? (100 - share) / (count - 1) : 100;
		handle.setLayout(
			Object.fromEntries(
				split.children.map((child, i) => [
					child.id,
					wide === -1
						? (split.sizes[i] ?? 100 / count)
						: i === wide
							? share
							: rest,
				]),
			),
		);
	}, [wide, screens, scrolls, count, split]);
	return (
		<ResizablePanelGroup
			key={`${split.direction}:${split.children.map((c) => c.id).join(",")}`}
			groupRef={group}
			orientation={split.direction === "row" ? "horizontal" : "vertical"}
			style={scrolls ? { width: `${screens * 100}%` } : undefined}
			onLayoutChanged={(next, meta) => {
				if (meta.isUserInteraction && wide === -1)
					view.onChange(resizeSplit(view.layout, split.id, next));
			}}
		>
			{split.children.map((child, i) => (
				<Split key={child.id} first={i === 0}>
					<ResizablePanel
						id={child.id}
						defaultSize={`${split.sizes[i] ?? 100 / count}%`}
						minSize={minSizeOf(child, split.direction, view.minWidth)}
						maxSize={widest === undefined ? undefined : `${widest}%`}
					>
						<NodeView node={child} view={view} />
					</ResizablePanel>
				</Split>
			))}
		</ResizablePanelGroup>
	);
}

function minSizeOf<T>(
	child: Node<T>,
	direction: Direction,
	minWidth: ((content: T) => number) | undefined,
): number | string {
	if (direction !== "row" || minWidth === undefined) return MIN_SPLIT;
	const floor = widthFloor(child, minWidth);
	return floor > 0 ? floor : MIN_SPLIT;
}

function Split({ first, children }: { first: boolean; children: ReactNode }) {
	return (
		<>
			{!first && <ResizableHandle />}
			{children}
		</>
	);
}

function PaneView<T>({
	pane,
	layout,
	previewing,
	dragging,
	tabKind,
	onChange,
	renderTab,
	tabLabel,
	entrance,
	maximized,
	maximize,
}: {
	pane: Pane<T>;
	layout: SplitLayout<T>;
	previewing: string | undefined;
	dragging: boolean;
	tabKind: string;
	onChange: (layout: SplitLayout<T>) => void;
	renderTab: (content: T, id: string) => ReactNode;
	tabLabel: (content: T) => string;
	entrance: (pane: Pane<T>) => string;
	maximized: Maximized | null;
	maximize: (maximized: Maximized | null) => void;
}) {
	const axes = axesAround(layout.root, pane.id);
	const enlarged = maximized?.pane === pane.id;
	const focused = layout.focused === pane.id;
	const arrival = entrance(pane);
	const shown = useRef<HTMLDivElement>(null);
	const arrived = arrival !== "";
	useEffect(() => {
		if (enlarged)
			shown.current?.scrollIntoView?.({
				behavior: "smooth",
				block: "nearest",
				inline: "start",
			});
	}, [enlarged]);
	useEffect(() => {
		if (arrived)
			shown.current?.scrollIntoView?.({
				behavior: "smooth",
				block: "nearest",
				inline: "start",
			});
	}, [arrived]);
	const lone = pane.tabs.length < 2;
	const takeFocus = () => {
		if (!focused && pane.active) onChange(focusTab(layout, pane.active));
	};
	const splitActive = (edge: Edge) => {
		if (pane.active)
			onChange(moveTab(layout, pane.active, { pane: pane.id, edge }));
	};
	return (
		<Tabs
			ref={shown}
			value={pane.active ?? undefined}
			onValueChange={(id) => onChange(focusTab(layout, id))}
			onPointerDownCapture={takeFocus}
			onFocusCapture={takeFocus}
			className={`flex h-full min-h-0 flex-col gap-0 ${arrival}`}
		>
			<div
				data-focused={focused}
				className="flex h-control flex-none items-center border-border border-b data-[focused=true]:border-b-accent"
			>
				<TabsList className="h-full min-w-0 flex-1 justify-start overflow-x-auto rounded-none bg-transparent p-0">
					{pane.tabs.map((tab, index) => (
						<TabHandle
							key={tab.id}
							tab={tab}
							kind={tabKind}
							pane={pane.id}
							index={index}
							label={tabLabel(tab.content)}
							onClose={
								tab.fixed ? undefined : () => onChange(closeTab(layout, tab.id))
							}
						/>
					))}
					<StripEnd pane={pane.id} index={pane.tabs.length} />
				</TabsList>
				<DropdownMenu>
					<DropdownMenuTrigger
						aria-label="split menu"
						className="flex h-full flex-none cursor-pointer items-center px-1.5 text-dim hover:text-fg"
					>
						<HugeiconsIcon className="size-icon-sm" icon={MoreHorizontalIcon} />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{enlarged ? (
							<DropdownMenuItem onSelect={() => maximize(null)}>
								<HugeiconsIcon icon={Minimize01Icon} />
								restore size
							</DropdownMenuItem>
						) : (
							<>
								<DropdownMenuItem
									disabled={!axes.includes("width")}
									onSelect={() => maximize({ pane: pane.id, axis: "width" })}
								>
									<HugeiconsIcon icon={ArrowLeftRightIcon} />
									maximize width
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={!axes.includes("height")}
									onSelect={() => maximize({ pane: pane.id, axis: "height" })}
								>
									<HugeiconsIcon icon={ArrowUpDownIcon} />
									maximize height
								</DropdownMenuItem>
							</>
						)}
						<DropdownMenuItem
							disabled={lone}
							onSelect={() => splitActive("right")}
						>
							<HugeiconsIcon icon={LayoutTwoColumnIcon} />
							split right
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={lone}
							onSelect={() => splitActive("bottom")}
						>
							<HugeiconsIcon icon={LayoutTwoRowIcon} />
							split down
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={layout.root?.kind !== "split"}
							onSelect={() => onChange(joinPane(layout, pane.id))}
						>
							join with neighbour
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={layout.root?.kind !== "split"}
							onSelect={() => onChange(flip(layout, pane.id))}
						>
							flip split
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={pane.tabs.some((t) => t.fixed)}
							onSelect={() => onChange(closePane(layout, pane.id))}
						>
							<HugeiconsIcon icon={Cancel01Icon} />
							close pane
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<div data-pane-body={pane.id} className="relative min-h-0 flex-1">
				{pane.tabs.length === 0 && <EmptyPane />}
				{pane.tabs.map((tab) => (
					<TabsContent
						key={tab.id}
						value={tab.id}
						className={`absolute inset-0 overflow-auto ${SLIDES_SHORT} ${dragging ? "pointer-events-none" : ""}`}
					>
						{tab.id === previewing ? (
							<Arriving />
						) : (
							renderTab(tab.content, tab.id)
						)}
					</TabsContent>
				))}
			</div>
		</Tabs>
	);
}

function Arriving() {
	return (
		<div className="absolute inset-2 rounded-md border-2 border-accent border-dashed bg-accent/10" />
	);
}

function EmptyPane() {
	return (
		<div className="absolute inset-2 flex flex-col items-center justify-center gap-2 rounded-md border border-border border-dashed text-dim">
			<HugeiconsIcon className="size-icon" icon={DragDropIcon} />
			drag anything in here
		</div>
	);
}

function TabHandle<T>({
	tab,
	kind,
	pane,
	index,
	label,
	onClose,
}: {
	tab: Tab<T>;
	kind: string;
	pane: string;
	index: number;
	label: string;
	onClose?: () => void;
}) {
	const carried = useCarried();
	const dragged = carried?.kind === kind && carried.payload === tab.id;
	const source = useDragSource(() => ({
		kind,
		payload: tab.id,
		ghost: <TabGhost label={label} />,
	}));
	return (
		<div
			data-tab-slot={index}
			data-pane={pane}
			className="group/tab relative flex h-full flex-none items-center border-border border-r has-[[data-state=active]]:bg-background dark:has-[[data-state=active]]:bg-input/30"
		>
			<TabsTrigger
				{...source}
				value={tab.id}
				title={label}
				className={`h-full max-w-48 flex-none truncate rounded-none border-0 shadow-none data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent ${dragged ? "opacity-40" : ""}`}
			>
				<span className="truncate">{label}</span>
			</TabsTrigger>
			{onClose && (
				<button
					type="button"
					aria-label={`close ${label}`}
					onClick={onClose}
					className="flex h-full flex-none cursor-pointer items-center pr-1.5 text-dim opacity-0 hover:text-fg group-focus-within/tab:opacity-100 group-hover/tab:opacity-100"
				>
					<HugeiconsIcon className="size-icon-xs" icon={Cancel01Icon} />
				</button>
			)}
		</div>
	);
}

function TabGhost({ label }: { label: string }) {
	return (
		<div className="flex h-full items-center rounded-md border border-border bg-bg2 px-2 text-fg">
			<span className="truncate">{label}</span>
		</div>
	);
}

function StripEnd({ pane, index }: { pane: string; index: number }) {
	return (
		<div
			data-tab-slot={index}
			data-pane={pane}
			className="relative h-full min-w-6 flex-1"
		/>
	);
}
