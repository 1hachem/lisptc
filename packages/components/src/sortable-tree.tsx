"use client";

import {
	type ClientRect,
	closestCenter,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	KeyboardSensor,
	MeasuringStrategy,
	PointerSensor,
	type UniqueIdentifier,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	restrictToHorizontalAxis,
	restrictToParentElement,
	restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
	type AnimateLayoutChanges,
	arrayMove,
	defaultAnimateLayoutChanges,
	SortableContext,
	type SortingStrategy,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS, type Transform } from "@dnd-kit/utilities";
import type { MotionId } from "@repo/ui/motions.ts";
import {
	createContext,
	type ReactNode,
	useContext,
	useState,
	useSyncExternalStore,
} from "react";

const DRAG_AFTER_PX = 4;
const LIFT_SCALE = 1.02;
const SETTLE = { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" };
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const REMEASURE_AS_ENTRIES_COLLAPSE = {
	droppable: { strategy: MeasuringStrategy.Always },
};

export function slotShift(
	rects: readonly ClientRect[],
	activeIndex: number,
	overIndex: number,
	index: number,
): number {
	const rect = rects[index];
	if (!rect || index === activeIndex) return 0;
	if (index > activeIndex && index <= overIndex) {
		const slot = rects[index - 1];
		return slot ? slot.left - rect.left : 0;
	}
	if (index < activeIndex && index >= overIndex) {
		const slot = rects[index + 1];
		return slot ? slot.right - rect.right : 0;
	}
	return 0;
}

const horizontalSlotStrategy: SortingStrategy = ({
	rects,
	activeIndex,
	overIndex,
	index,
}) => ({
	x: slotShift(rects, activeIndex, overIndex, index),
	y: 0,
	scaleX: 1,
	scaleY: 1,
});

const AXES = {
	vertical: {
		modifier: restrictToVerticalAxis,
		strategy: verticalListSortingStrategy,
	},
	horizontal: {
		modifier: restrictToHorizontalAxis,
		strategy: horizontalSlotStrategy,
	},
};

const EntryDragged = createContext(false);

export function useEntryDragged() {
	return useContext(EntryDragged);
}

export function moved<Id extends string>(
	order: readonly Id[],
	active: Id,
	over: Id | undefined,
): Id[] | undefined {
	if (over === undefined || active === over) return undefined;
	const from = order.indexOf(active);
	const to = order.indexOf(over);
	if (from < 0 || to < 0) return undefined;
	return arrayMove([...order], from, to);
}

export function awaitingOrder<Id extends string>(
	order: readonly Id[],
	dropped: { next: readonly Id[]; over: readonly Id[] } | undefined,
): readonly Id[] {
	return dropped && dropped.over.join("\0") === order.join("\0")
		? dropped.next
		: order;
}

export function unzoomed(
	transform: Transform | null,
	zoom: number,
): Transform | null {
	if (transform === null || zoom === 1) return transform;
	return { ...transform, x: transform.x / zoom, y: transform.y / zoom };
}

export function ownSize(transform: Transform, motion: MotionId): Transform {
	const scale = motion === "lift" ? LIFT_SCALE : 1;
	return { ...transform, scaleX: scale, scaleY: scale };
}

function subscribeReducedMotion(onChange: () => void) {
	const query = window.matchMedia(REDUCED_MOTION);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion() {
	return useSyncExternalStore(
		subscribeReducedMotion,
		() => window.matchMedia(REDUCED_MOTION).matches,
		() => false,
	);
}

const glideAfterDrop: AnimateLayoutChanges = (args) =>
	defaultAnimateLayoutChanges({ ...args, wasDragging: true });

const neverAnimate: AnimateLayoutChanges = () => false;

const ENTRY_MOTION = {
	slide: {},
	lift: { transition: SETTLE, animateLayoutChanges: glideAfterDrop },
	overlay: { transition: SETTLE },
	none: { transition: null, animateLayoutChanges: neverAnimate },
} satisfies Record<MotionId, Omit<Parameters<typeof useSortable>[0], "id">>;

const DRAGGING_CLASS: Record<MotionId, string> = {
	slide: "relative z-10 bg-bg2 opacity-80",
	lift: "relative z-10 cursor-grabbing bg-bg2 shadow-lg",
	overlay: "opacity-40",
	none: "relative z-10 bg-bg2",
};

function SortableEntry({
	id,
	motion,
	className = "",
	children,
}: {
	id: string;
	motion: MotionId;
	className?: string;
	children: ReactNode;
}) {
	const {
		attributes,
		listeners,
		node,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id, ...ENTRY_MOTION[motion] });
	const zoom = node.current?.currentCSSZoom ?? 1;
	const shifted = unzoomed(transform, zoom);
	const lifted = shifted && isDragging ? ownSize(shifted, motion) : shifted;
	return (
		<div
			ref={(element) => {
				setNodeRef(element);
				setActivatorNodeRef(element);
			}}
			{...attributes}
			{...listeners}
			data-entry={id}
			data-dragging={isDragging}
			style={{ transform: CSS.Transform.toString(lifted), transition }}
			className={`outline-none focus-visible:bg-bg2 ${className} ${
				isDragging ? DRAGGING_CLASS[motion] : ""
			}`}
		>
			<EntryDragged value={isDragging}>{children}</EntryDragged>
		</div>
	);
}

export function SortableTree<Id extends string>({
	order: given,
	onReorder,
	onPickUp,
	motion = "slide",
	axis = "vertical",
	className,
	entryClassName,
	children,
}: {
	order: readonly Id[];
	onReorder: (next: Id[]) => void;
	onPickUp?: (id: Id) => void;
	motion?: MotionId;
	axis?: keyof typeof AXES;
	className?: string;
	entryClassName?: (id: Id, index: number) => string;
	children: (id: Id) => ReactNode;
}) {
	const reduced = usePrefersReducedMotion();
	const shown: MotionId = reduced ? "none" : motion;
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const [dragged, setDragged] = useState<Id>();
	const [dropped, setDropped] = useState<{
		next: readonly Id[];
		over: readonly Id[];
	}>();
	const order = awaitingOrder(given, dropped);
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: DRAG_AFTER_PX },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const entry = (id: UniqueIdentifier | undefined) =>
		order.find((candidate) => candidate === id);
	const onDragStart = ({ active }: DragStartEvent) => {
		const picked = entry(active.id);
		setDragged(picked);
		if (picked) onPickUp?.(picked);
	};
	const onDragEnd = ({ active, over }: DragEndEvent) => {
		setDragged(undefined);
		const from = entry(active.id);
		const next = from && moved(order, from, entry(over?.id));
		if (!next) return;
		setDropped({ next, over: given });
		onReorder(next);
	};
	const zoom = root?.currentCSSZoom ?? 1;
	return (
		<div ref={setRoot} data-motion={shown} className={className}>
			<DndContext
				sensors={sensors}
				measuring={REMEASURE_AS_ENTRIES_COLLAPSE}
				collisionDetection={closestCenter}
				modifiers={[AXES[axis].modifier, restrictToParentElement]}
				onDragStart={onDragStart}
				onDragEnd={onDragEnd}
				onDragCancel={() => setDragged(undefined)}
			>
				<SortableContext items={[...order]} strategy={AXES[axis].strategy}>
					{order.map((id, index) => (
						<SortableEntry
							key={id}
							id={id}
							motion={shown}
							className={entryClassName?.(id, index)}
						>
							{children(id)}
						</SortableEntry>
					))}
				</SortableContext>
				{shown === "overlay" && (
					<div style={{ zoom: 1 / zoom }}>
						<DragOverlay dropAnimation={SETTLE}>
							{dragged && (
								<div
									style={{ zoom }}
									className="cursor-grabbing bg-bg2 shadow-lg"
								>
									<EntryDragged value>{children(dragged)}</EntryDragged>
								</div>
							)}
						</DragOverlay>
					</div>
				)}
			</DndContext>
		</div>
	);
}
