"use client";

import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	PointerSensor,
	pointerWithin,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	Cancel01Icon,
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
	useMemo,
	useState,
} from "react";
import { useNativeDrag, useNativeDropTarget } from "./native-drag.ts";
import {
	closeTab,
	type Drop,
	dropTab,
	type Edge,
	flip,
	focusTab,
	joinPane,
	moveTab,
	type Pane,
	resizeGroups,
	resizePanes,
	type SplitLayout,
	type Tab,
} from "./split-layout.ts";

const DRAG_AFTER_PX = 4;
const MIN_SPLIT = "12%";
const EDGES: Edge[] = ["left", "right", "top", "bottom"];
const EDGE_ZONE: Record<Edge, string> = {
	left: "inset-y-0 left-0 w-1/4",
	right: "inset-y-0 right-0 w-1/4",
	top: "inset-x-0 top-0 h-1/4",
	bottom: "inset-x-0 bottom-0 h-1/4",
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
	renderTab: (content: T) => ReactNode;
	tabLabel: (content: T) => string;
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
	external,
}: SplitViewProps<T>) {
	const [dragged, setDragged] = useState<Tab<T> | null>(null);
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
	const onDragStart = (event: DragStartEvent) =>
		setDragged((event.active.data.current?.tab as Tab<T>) ?? null);
	const onDragEnd = (event: DragEndEvent) => {
		setDragged(null);
		const drop = event.over?.data.current?.drop as Drop | undefined;
		if (drop) onChange(moveTab(layout, String(event.active.id), drop));
	};
	const horizontal = layout.direction === "row";
	return (
		<ExternalDrop.Provider value={accepts}>
			<DndContext
				sensors={sensors}
				collisionDetection={pointerWithin}
				onDragStart={onDragStart}
				onDragEnd={onDragEnd}
				onDragCancel={() => setDragged(null)}
			>
				<ResizablePanelGroup
					key={`${layout.direction}:${layout.groups.map((g) => g.id).join(",")}`}
					orientation={horizontal ? "horizontal" : "vertical"}
					onLayoutChanged={(sizes, meta) => {
						if (meta.isUserInteraction) onChange(resizeGroups(layout, sizes));
					}}
				>
					{layout.groups.map((group, g) => (
						<Split key={group.id} first={g === 0}>
							<ResizablePanel
								id={group.id}
								defaultSize={`${group.size}%`}
								minSize={MIN_SPLIT}
							>
								<ResizablePanelGroup
									key={group.panes.map((p) => p.id).join(",")}
									orientation={horizontal ? "vertical" : "horizontal"}
									onLayoutChanged={(sizes, meta) => {
										if (meta.isUserInteraction)
											onChange(resizePanes(layout, group.id, sizes));
									}}
								>
									{group.panes.map((pane, p) => (
										<Split key={pane.id} first={p === 0}>
											<ResizablePanel
												id={pane.id}
												defaultSize={`${pane.size}%`}
												minSize={MIN_SPLIT}
											>
												<PaneView
													pane={pane}
													layout={layout}
													dragging={dragged !== null || outside}
													onChange={onChange}
													renderTab={renderTab}
													tabLabel={tabLabel}
												/>
											</ResizablePanel>
										</Split>
									))}
								</ResizablePanelGroup>
							</ResizablePanel>
						</Split>
					))}
				</ResizablePanelGroup>
				<DragOverlay dropAnimation={null}>
					{dragged && (
						<div className="flex h-row items-center rounded-md border border-border bg-bg2 px-2 text-fg shadow-sm">
							{tabLabel(dragged.content)}
						</div>
					)}
				</DragOverlay>
			</DndContext>
		</ExternalDrop.Provider>
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
}: {
	pane: Pane<T>;
	layout: SplitLayout<T>;
	dragging: boolean;
	onChange: (layout: SplitLayout<T>) => void;
	renderTab: (content: T) => ReactNode;
	tabLabel: (content: T) => string;
}) {
	const focused = layout.focused === pane.id;
	const lone = pane.tabs.length < 2;
	const splitActive = (edge: Edge) => {
		if (pane.active)
			onChange(moveTab(layout, pane.active, { pane: pane.id, edge }));
	};
	return (
		<Tabs
			value={pane.active ?? undefined}
			onValueChange={(id) => onChange(focusTab(layout, id))}
			className="flex h-full min-h-0 flex-col gap-0"
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
							onClose={() => onChange(closeTab(layout, tab.id))}
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
							disabled={layout.groups.flatMap((g) => g.panes).length < 2}
							onSelect={() => onChange(joinPane(layout, pane.id))}
						>
							join with neighbour
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => onChange(flip(layout))}>
							flip layout
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<div className="relative min-h-0 flex-1">
				{pane.tabs.map((tab) => (
					<TabsContent
						key={tab.id}
						value={tab.id}
						className="absolute inset-0 overflow-auto"
					>
						{renderTab(tab.content)}
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
	onClose: () => void;
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
			<button
				type="button"
				aria-label={`close ${label}`}
				onClick={onClose}
				className="flex h-full flex-none cursor-pointer items-center pr-1.5 text-dim opacity-0 hover:text-fg group-hover/tab:opacity-100"
			>
				<HugeiconsIcon className="size-icon-xs" icon={Cancel01Icon} />
			</button>
		</div>
	);
}

function StripEnd({ drop }: { drop: Drop }) {
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
			className={`pointer-events-none absolute z-10 rounded-sm border-2 border-accent bg-accent/15 ${className}`}
		/>
	);
}
