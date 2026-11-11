"use client";

import {
	type Collision,
	type CollisionDetection,
	closestCenter,
	DndContext,
	type DragEndEvent,
	type DragOverEvent,
	type DragStartEvent,
	KeyboardSensor,
	MeasuringStrategy,
	PointerSensor,
	pointerWithin,
	type UniqueIdentifier,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { MotionId } from "@repo/ui/motions.ts";
import { createContext, type ReactNode, useContext, useState } from "react";
import { CursorDragOverlay } from "./cursor-drag-overlay.tsx";
import { SortableEntry, usePrefersReducedMotion } from "./sortable-tree.tsx";

const DRAG_AFTER_PX = 4;
const SIDE_PREFIX = "side:";

export type Sides<Side extends string, Id extends string> = Record<
	Side,
	readonly Id[]
>;

function sideTarget(side: string): string {
	return `${SIDE_PREFIX}${side}`;
}

function sideOf<Side extends string, Id extends string>(
	sides: Sides<Side, Id>,
	id: UniqueIdentifier | undefined,
): Side | undefined {
	if (id === undefined) return undefined;
	const named = String(id);
	const all = Object.keys(sides) as Side[];
	if (named.startsWith(SIDE_PREFIX)) {
		const side = named.slice(SIDE_PREFIX.length);
		return all.find((candidate) => candidate === side);
	}
	return all.find((side) => sides[side].includes(named as Id));
}

export function movedAcross<Side extends string, Id extends string>(
	sides: Sides<Side, Id>,
	active: Id,
	over: UniqueIdentifier | undefined,
): Sides<Side, Id> | undefined {
	const from = sideOf(sides, active);
	const to = sideOf(sides, over);
	if (from === undefined || to === undefined) return undefined;
	if (from === to) {
		const list = sides[from];
		const at = list.indexOf(over as Id);
		if (at < 0 || over === active) return undefined;
		return {
			...sides,
			[from]: arrayMove([...list], list.indexOf(active), at),
		};
	}
	const target = sides[to];
	const at = target.indexOf(over as Id);
	const placed = at < 0 ? target.length : at;
	return {
		...sides,
		[from]: sides[from].filter((id) => id !== active),
		[to]: [...target.slice(0, placed), active, ...target.slice(placed)],
	};
}

function sameSides<Side extends string, Id extends string>(
	a: Sides<Side, Id>,
	b: Sides<Side, Id>,
): boolean {
	const all = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<Side>;
	return [...all].every(
		(side) => (a[side] ?? []).join("\0") === (b[side] ?? []).join("\0"),
	);
}

interface Dropped<Side extends string, Id extends string> {
	next: Sides<Side, Id>;
	over: Sides<Side, Id>;
}

export function stillAwaiting<Side extends string, Id extends string>(
	given: Sides<Side, Id>,
	dropped: Dropped<Side, Id> | undefined,
): Dropped<Side, Id> | undefined {
	return dropped && sameSides(dropped.over, given) ? dropped : undefined;
}

export function awaitingSides<Side extends string, Id extends string>(
	given: Sides<Side, Id>,
	dropped: Dropped<Side, Id> | undefined,
): Sides<Side, Id> {
	return stillAwaiting(given, dropped)?.next ?? given;
}

const preferEntries: CollisionDetection = (args) => {
	const within = pointerWithin(args);
	const isSide = (hit: Collision) => String(hit.id).startsWith(SIDE_PREFIX);
	const entries = within.filter((hit) => !isSide(hit));
	if (entries.length > 0) return entries;
	if (within.length > 0) return within;
	return closestCenter(args);
};

interface SidesState {
	sides: Sides<string, string>;
	motion: MotionId;
}

const SidesContext = createContext<SidesState | null>(null);

export function SortableSides<Side extends string, Id extends string>({
	sides: given,
	onMove,
	onPickUp,
	motion = "slide",
	overlay,
	children,
}: {
	sides: Sides<Side, Id>;
	onMove: (next: Sides<Side, Id>) => void;
	onPickUp?: (id: Id) => void;
	motion?: MotionId;
	overlay: (id: Id) => ReactNode;
	children: ReactNode;
}) {
	const reduced = usePrefersReducedMotion();
	const shown: MotionId = reduced || motion === "none" ? "none" : "overlay";
	const [live, setLive] = useState<Sides<Side, Id>>();
	const [dragged, setDragged] = useState<Id>();
	const [dropped, setDropped] = useState<Dropped<Side, Id>>();
	const held = stillAwaiting(given, dropped);
	if (held !== dropped) setDropped(held);
	const settledSides = awaitingSides(given, held);
	const sides = live ?? settledSides;
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: DRAG_AFTER_PX },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const entry = (id: UniqueIdentifier) =>
		sideOf(sides, id) === undefined || String(id).startsWith(SIDE_PREFIX)
			? undefined
			: (String(id) as Id);
	const onDragStart = ({ active }: DragStartEvent) => {
		const picked = entry(active.id);
		setDragged(picked);
		setLive(settledSides);
		if (picked) onPickUp?.(picked);
	};
	const onDragOver = ({ active, over }: DragOverEvent) => {
		const picked = entry(active.id);
		if (!picked) return;
		if (sideOf(sides, picked) === sideOf(sides, over?.id)) return;
		const next = movedAcross(sides, picked, over?.id);
		if (next) setLive(next);
	};
	const onDragEnd = ({ active, over }: DragEndEvent) => {
		const picked = entry(active.id);
		const next = picked && movedAcross(sides, picked, over?.id);
		const settled = next ?? sides;
		setDragged(undefined);
		setLive(undefined);
		if (sameSides(settled, settledSides)) return;
		setDropped({ next: settled, over: given });
		onMove(settled);
	};
	const onDragCancel = () => {
		setDragged(undefined);
		setLive(undefined);
	};
	return (
		<DndContext
			sensors={sensors}
			measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
			collisionDetection={preferEntries}
			onDragStart={onDragStart}
			onDragOver={onDragOver}
			onDragEnd={onDragEnd}
			onDragCancel={onDragCancel}
		>
			<SidesContext value={{ sides, motion: shown }}>{children}</SidesContext>
			<CursorDragOverlay dropAnimation={null}>
				{dragged && <div className="cursor-grabbing">{overlay(dragged)}</div>}
			</CursorDragOverlay>
		</DndContext>
	);
}

export function SortableSide<Id extends string>({
	side,
	className = "",
	entryClassName,
	children,
}: {
	side: string;
	className?: string;
	entryClassName?: (id: Id, index: number) => string;
	children: (id: Id) => ReactNode;
}) {
	const context = useContext(SidesContext);
	if (context === null)
		throw new Error("SortableSide must be used within SortableSides");
	const { setNodeRef, isOver } = useDroppable({ id: sideTarget(side) });
	const order = (context.sides[side] ?? []) as readonly Id[];
	return (
		<div
			ref={setNodeRef}
			data-side={side}
			data-over={isOver}
			className={className}
		>
			<SortableContext
				items={[...order]}
				strategy={verticalListSortingStrategy}
			>
				{order.map((id, index) => (
					<SortableEntry
						key={id}
						id={id}
						motion={context.motion}
						className={entryClassName?.(id, index)}
					>
						{children(id)}
					</SortableEntry>
				))}
			</SortableContext>
		</div>
	);
}
