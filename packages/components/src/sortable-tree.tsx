"use client";

import {
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
	restrictToParentElement,
	restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
	type AnimateLayoutChanges,
	arrayMove,
	defaultAnimateLayoutChanges,
	SortableContext,
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

export function unzoomed(
	transform: Transform | null,
	zoom: number,
): Transform | null {
	if (transform === null || zoom === 1) return transform;
	return { ...transform, x: transform.x / zoom, y: transform.y / zoom };
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
	children,
}: {
	id: string;
	motion: MotionId;
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
	const lifted =
		shifted && isDragging && motion === "lift"
			? { ...shifted, scaleX: LIFT_SCALE, scaleY: LIFT_SCALE }
			: shifted;
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
			className={`outline-none focus-visible:bg-bg2 ${
				isDragging ? DRAGGING_CLASS[motion] : ""
			}`}
		>
			<EntryDragged value={isDragging}>{children}</EntryDragged>
		</div>
	);
}

export function SortableTree<Id extends string>({
	order,
	onReorder,
	onPickUp,
	motion = "slide",
	children,
}: {
	order: readonly Id[];
	onReorder: (next: Id[]) => void;
	onPickUp?: (id: Id) => void;
	motion?: MotionId;
	children: (id: Id) => ReactNode;
}) {
	const reduced = usePrefersReducedMotion();
	const shown: MotionId = reduced ? "none" : motion;
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const [dragged, setDragged] = useState<Id>();
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
		if (next) onReorder(next);
	};
	const zoom = root?.currentCSSZoom ?? 1;
	return (
		<div ref={setRoot} data-motion={shown}>
			<DndContext
				sensors={sensors}
				measuring={REMEASURE_AS_ENTRIES_COLLAPSE}
				collisionDetection={closestCenter}
				modifiers={[restrictToVerticalAxis, restrictToParentElement]}
				onDragStart={onDragStart}
				onDragEnd={onDragEnd}
				onDragCancel={() => setDragged(undefined)}
			>
				<SortableContext
					items={[...order]}
					strategy={verticalListSortingStrategy}
				>
					{order.map((id) => (
						<SortableEntry key={id} id={id} motion={shown}>
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
