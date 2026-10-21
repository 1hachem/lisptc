"use client";

import {
	DndContext,
	type DragEndEvent,
	type DragMoveEvent,
	type DragStartEvent,
	MeasuringStrategy,
	PointerSensor,
	pointerWithin,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	Cancel01Icon,
	DragDropIcon,
	LayoutTwoColumnIcon,
	LayoutTwoRowIcon,
	MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useNativeDrag, useNativeDropTarget } from "./native-drag.ts";
import {
	closePane,
	closeTab,
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
} from "./split-layout.ts";

const DRAG_AFTER_PX = 4;
const ZOOMS_IN =
	"group-data-[animated=true]/split:animate-zoom-in motion-reduce:animate-none";
const SLIDES_IN =
	"group-data-[animated=true]/split:animate-slide-in motion-reduce:animate-none";
const SLIDES_SHORT =
	"group-data-[animated=true]/split:animate-slide-short motion-reduce:animate-none";
const FADES =
	"group-data-[animated=true]/split:animate-fade motion-reduce:animate-none";
const CURSOR_GAP = 8;
const UNZOOMED = "calc(1 / var(--app-zoom, 1))";
const REZOOMED = "var(--app-zoom, 1)";
const MEASURE_WHILE_DRAGGING = {
	droppable: { strategy: MeasuringStrategy.Always },
};
const MIN_SPLIT = "12%";
const VISIBLE_COLUMNS = 2;
const EDGES: Edge[] = ["left", "right", "top", "bottom"];
const EDGE_ZONE: Record<Edge, string> = {
	left: "inset-y-0 left-0 w-1/4",
	right: "inset-y-0 right-0 w-1/4",
	top: "inset-x-0 top-0 h-1/4",
	bottom: "inset-x-0 bottom-0 h-1/4",
};
const VIEW_EDGE_ZONE: Record<Edge, string> = {
	left: "inset-y-0 left-0 w-3",
	right: "inset-y-0 right-0 w-3",
	top: "inset-x-0 top-0 h-3",
	bottom: "inset-x-0 bottom-0 h-3",
};
const EDGE_LANDS: Record<Edge, string> = {
	left: "inset-y-0 left-0 w-1/2",
	right: "inset-y-0 right-0 w-1/2",
	top: "inset-x-0 top-0 h-1/2",
	bottom: "inset-x-0 bottom-0 h-1/2",
};

interface External {
	type: string;
	drop: (drop: Drop, data: DataTransfer) => void;
}

const ExternalDrop = createContext<External | null>(null);

export interface SplitViewProps<T> {
	layout: SplitLayout<T>;
	onChange: (layout: SplitLayout<T>) => void;
	renderTab: (content: T, id: string) => ReactNode;
	tabLabel: (content: T) => string;
	animated?: boolean;
	placeholder?: ReactNode;
	external?: {
		type: string;
		read: (data: DataTransfer) => Tab<T> | undefined;
	};
}

export function SplitView<T>({
	layout,
	onChange,
	renderTab,
	tabLabel,
	animated = false,
	placeholder,
	external,
}: SplitViewProps<T>) {
	const [dragged, setDragged] = useState<Tab<T> | null>(null);
	const [pointer, setPointer] = useState({ x: 0, y: 0 });
	const origin = useRef({ x: 0, y: 0 });
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
	const outside = useNativeDrag(external?.type);
	const accepts = useMemo<External | null>(
		() =>
			external === undefined
				? null
				: {
						type: external.type,
						drop: (drop, data) => {
							const tab = external.read(data);
							if (tab) onChange(dropTab(layout, tab, drop));
						},
					},
		[external, layout, onChange],
	);
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: DRAG_AFTER_PX },
		}),
	);
	const onDragStart = (event: DragStartEvent) => {
		const start = event.activatorEvent as PointerEvent;
		origin.current = { x: start.clientX, y: start.clientY };
		setPointer(origin.current);
		setDragged((event.active.data.current?.tab as Tab<T>) ?? null);
	};
	const onDragMove = (event: DragMoveEvent) =>
		setPointer({
			x: origin.current.x + event.delta.x,
			y: origin.current.y + event.delta.y,
		});
	const onDragEnd = (event: DragEndEvent) => {
		setDragged(null);
		const drop = event.over?.data.current?.drop as Drop | undefined;
		moved.current = String(event.active.id);
		if (drop) onChange(moveTab(layout, String(event.active.id), drop));
	};
	const dragging = dragged !== null || outside;
	const view = { layout, dragging, onChange, renderTab, tabLabel, entrance };
	return (
		<ExternalDrop.Provider value={accepts}>
			<DndContext
				sensors={sensors}
				collisionDetection={pointerWithin}
				measuring={MEASURE_WHILE_DRAGGING}
				onDragStart={onDragStart}
				onDragMove={onDragMove}
				onDragEnd={onDragEnd}
				onDragCancel={() => setDragged(null)}
			>
				<div
					data-animated={animated}
					className="group/split relative h-full min-h-0"
				>
					{layout.root ? (
						<div className="h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-none">
							<NodeView node={layout.root} view={view} root />
						</div>
					) : (
						<div className="flex h-full items-center justify-center">
							{placeholder}
						</div>
					)}
					{dragging && !layout.root && (
						<Zone id="view" drop={{ pane: "" }} hit="inset-0" lands="inset-0" />
					)}
					{dragging &&
						layout.root &&
						EDGES.map((edge) => (
							<Zone
								key={edge}
								id={`view:${edge}`}
								drop={{ node: (layout.root as Node<T>).id, edge }}
								hit={`z-20 ${VIEW_EDGE_ZONE[edge]}`}
								lands={`z-20 ${EDGE_LANDS[edge]}`}
							/>
						))}
				</div>
				{typeof document !== "undefined" &&
					createPortal(
						dragged && (
							<div
								className="pointer-events-none fixed z-50"
								style={{
									zoom: UNZOOMED,
									left: pointer.x + CURSOR_GAP,
									top: pointer.y + CURSOR_GAP,
								}}
							>
								<div
									className="flex h-row items-center rounded-md border border-border bg-bg2 px-2 text-fg shadow-sm"
									style={{ zoom: REZOOMED }}
								>
									{tabLabel(dragged.content)}
								</div>
							</div>
						),
						document.body,
					)}
			</DndContext>
		</ExternalDrop.Provider>
	);
}

interface View<T> {
	layout: SplitLayout<T>;
	dragging: boolean;
	onChange: (layout: SplitLayout<T>) => void;
	renderTab: (content: T, id: string) => ReactNode;
	tabLabel: (content: T) => string;
	entrance: (pane: Pane<T>) => string;
}

function paneIds<T>(node: Node<T> | null): string[] {
	if (node === null) return [];
	if (node.kind === "pane") return [node.id];
	return node.children.flatMap((child) => paneIds(child));
}

function overflowWidth<T>(node: Node<T>): string | undefined {
	if (node.kind !== "split" || node.direction !== "row") return undefined;
	if (node.children.length <= VISIBLE_COLUMNS) return undefined;
	return `${(node.children.length / VISIBLE_COLUMNS) * 100}%`;
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
	const width = root ? overflowWidth(node) : undefined;
	return (
		<ResizablePanelGroup
			key={`${node.direction}:${node.children.map((c) => c.id).join(",")}`}
			orientation={node.direction === "row" ? "horizontal" : "vertical"}
			style={width ? { width } : undefined}
			onLayoutChanged={(sizes, meta) => {
				if (meta.isUserInteraction)
					view.onChange(resizeSplit(view.layout, node.id, sizes));
			}}
		>
			{node.children.map((child, i) => (
				<Split key={child.id} first={i === 0}>
					<ResizablePanel
						id={child.id}
						defaultSize={`${node.sizes[i] ?? 100 / node.children.length}%`}
						minSize={MIN_SPLIT}
						className={width ? "snap-start" : undefined}
					>
						<NodeView node={child} view={view} />
					</ResizablePanel>
				</Split>
			))}
		</ResizablePanelGroup>
	);
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
	dragging,
	onChange,
	renderTab,
	tabLabel,
	entrance,
}: {
	pane: Pane<T>;
	layout: SplitLayout<T>;
	dragging: boolean;
	onChange: (layout: SplitLayout<T>) => void;
	renderTab: (content: T, id: string) => ReactNode;
	tabLabel: (content: T) => string;
	entrance: (pane: Pane<T>) => string;
}) {
	const focused = layout.focused === pane.id;
	const arrival = entrance(pane);
	const shown = useRef<HTMLDivElement>(null);
	const arrived = arrival !== "";
	useEffect(() => {
		if (arrived)
			shown.current?.scrollIntoView?.({
				behavior: "smooth",
				block: "nearest",
				inline: "nearest",
			});
	}, [arrived]);
	const lone = pane.tabs.length < 2;
	const splitActive = (edge: Edge) => {
		if (pane.active)
			onChange(moveTab(layout, pane.active, { pane: pane.id, edge }));
	};
	return (
		<Tabs
			ref={shown}
			value={pane.active ?? undefined}
			onValueChange={(id) => onChange(focusTab(layout, id))}
			className={`flex h-full min-h-0 flex-col gap-0 ${arrival}`}
		>
			<div
				data-focused={focused}
				className="flex h-control flex-none items-center border-border border-b"
			>
				<TabsList className="h-full min-w-0 flex-1 justify-start overflow-x-auto rounded-none bg-transparent p-0">
					{pane.tabs.map((tab, index) => (
						<TabHandle
							key={tab.id}
							tab={tab}
							drop={{ pane: pane.id, index }}
							label={tabLabel(tab.content)}
							onClose={
								tab.fixed ? undefined : () => onChange(closeTab(layout, tab.id))
							}
						/>
					))}
					<StripEnd drop={{ pane: pane.id, index: pane.tabs.length }} />
				</TabsList>
				<DropdownMenu>
					<DropdownMenuTrigger
						aria-label="split menu"
						className="flex h-full flex-none cursor-pointer items-center px-1.5 text-dim hover:text-fg"
					>
						<HugeiconsIcon className="size-icon-sm" icon={MoreHorizontalIcon} />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
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
			<div className="relative min-h-0 flex-1">
				{pane.tabs.length === 0 && <EmptyPane />}
				{pane.tabs.map((tab) => (
					<TabsContent
						key={tab.id}
						value={tab.id}
						className={`absolute inset-0 overflow-auto ${SLIDES_SHORT} ${dragging ? "pointer-events-none" : ""}`}
					>
						{renderTab(tab.content, tab.id)}
					</TabsContent>
				))}
				{dragging && (
					<>
						<Zone
							id={`center:${pane.id}`}
							drop={{ pane: pane.id }}
							hit="inset-1/4"
							lands="inset-0"
						/>
						{EDGES.map((edge) => (
							<Zone
								key={edge}
								id={`edge:${pane.id}:${edge}`}
								drop={{ pane: pane.id, edge }}
								hit={EDGE_ZONE[edge]}
								lands={EDGE_LANDS[edge]}
							/>
						))}
					</>
				)}
			</div>
		</Tabs>
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

function useTarget(id: string, drop: Drop) {
	const target = useDroppable({ id, data: { drop } });
	const external = useContext(ExternalDrop);
	const native = useNativeDropTarget(external?.type, (data) =>
		external?.drop(drop, data),
	);
	return {
		ref: target.setNodeRef,
		over: target.isOver || native.over,
		native: native.handlers,
	};
}

function InsertMark({ shown }: { shown: boolean }) {
	return shown ? (
		<span className="pointer-events-none absolute inset-y-1 left-0 w-0.5 bg-accent" />
	) : null;
}

function TabHandle<T>({
	tab,
	drop,
	label,
	onClose,
}: {
	tab: Tab<T>;
	drop: Drop;
	label: string;
	onClose?: () => void;
}) {
	const drag = useDraggable({ id: tab.id, data: { tab } });
	const target = useTarget(`tab:${tab.id}`, drop);
	return (
		<div
			ref={target.ref}
			{...target.native}
			className="group/tab relative flex h-full flex-none items-center border-border border-r"
		>
			<InsertMark shown={target.over} />
			<TabsTrigger
				ref={drag.setNodeRef}
				{...drag.listeners}
				{...drag.attributes}
				value={tab.id}
				title={label}
				className={`h-full max-w-48 flex-none truncate rounded-none border-0 shadow-none ${drag.isDragging ? "opacity-40" : ""}`}
			>
				<span className="truncate">{label}</span>
			</TabsTrigger>
			{onClose && (
				<button
					type="button"
					aria-label={`close ${label}`}
					onClick={onClose}
					className="flex h-full flex-none cursor-pointer items-center pr-1.5 text-dim opacity-0 hover:text-fg group-hover/tab:opacity-100"
				>
					<HugeiconsIcon className="size-icon-xs" icon={Cancel01Icon} />
				</button>
			)}
		</div>
	);
}

function StripEnd({ drop }: { drop: { pane: string; index: number } }) {
	const target = useTarget(`end:${drop.pane}`, drop);
	return (
		<div
			ref={target.ref}
			{...target.native}
			className="relative h-full min-w-6 flex-1"
		>
			<InsertMark shown={target.over} />
		</div>
	);
}

function Zone({
	id,
	drop,
	hit,
	lands,
}: {
	id: string;
	drop: Drop;
	hit: string;
	lands: string;
}) {
	const target = useTarget(id, drop);
	return (
		<>
			<div
				ref={target.ref}
				{...target.native}
				data-drop={id}
				className={`absolute ${hit}`}
			/>
			{target.over && <DropPreview className={lands} />}
		</>
	);
}

export function DropPreview({ className }: { className: string }) {
	return (
		<div
			className={`pointer-events-none absolute z-10 rounded-sm border-2 border-accent bg-accent/15 ${FADES} ${className}`}
		/>
	);
}
