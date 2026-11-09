"use client";

import type { MotionId } from "@repo/ui/motions.ts";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useId,
	useState,
} from "react";
import {
	type DropSpot,
	type Rect,
	rectOf,
	useCarried,
	useDragSource,
	useDropSpots,
} from "./drag-layer.tsx";
import { EntryDragged, usePrefersReducedMotion } from "./sortable-tree.tsx";

const LINE_PX = 2;

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
	id: string | undefined,
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
	over: string | undefined,
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
			[from]: moveTo(list, list.indexOf(active), at),
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
	dropped: { next: Sides<Side, Id>; over: Sides<Side, Id> } | undefined,
): { next: Sides<Side, Id>; over: Sides<Side, Id> } | undefined {
	return dropped && sameSides(dropped.over, given) ? dropped : undefined;
}

export function awaitingSides<Side extends string, Id extends string>(
	given: Sides<Side, Id>,
	dropped: { next: Sides<Side, Id>; over: Sides<Side, Id> } | undefined,
): Sides<Side, Id> {
	return stillAwaiting(given, dropped)?.next ?? given;
}

function moveTo<Id>(list: readonly Id[], from: number, to: number): Id[] {
	const next = [...list];
	const [picked] = next.splice(from, 1);
	if (picked !== undefined) next.splice(to, 0, picked);
	return next;
}

function lineAt(rect: Rect, below: boolean): Rect {
	return {
		left: rect.left,
		top: below ? rect.top + rect.height - LINE_PX / 2 : rect.top - LINE_PX / 2,
		width: rect.width,
		height: LINE_PX,
	};
}

interface SidesState {
	sides: Sides<string, string>;
	kind: string;
	motion: MotionId;
	ghost: (id: string) => ReactNode;
	onPickUp?: (id: string) => void;
}

const SidesContext = createContext<SidesState | null>(null);

function sideElements(kind: string): Element[] {
	return [...document.querySelectorAll(`[data-sides="${CSS.escape(kind)}"]`)];
}

function spotsFor<Side extends string, Id extends string>(
	sides: Sides<Side, Id>,
	kind: string,
	active: Id,
	settle: (next: Sides<Side, Id>) => void,
	preview: ((next: Sides<Side, Id> | undefined) => void) | undefined,
): DropSpot[] {
	const from = sideOf(sides, active);
	const spot = (hit: Rect, line: Rect, next: Sides<Side, Id>): DropSpot =>
		preview
			? {
					hit,
					enter: () => preview(next),
					leave: () => preview(undefined),
					drop: () => settle(next),
				}
			: { hit, shows: line, drop: () => settle(next) };
	return sideElements(kind).flatMap((element) => {
		const side = element.getAttribute("data-side") as Side | null;
		if (side === null || !(side in sides)) return [];
		const list = sides[side];
		const entries = [...element.querySelectorAll(":scope > [data-entry]")];
		const onEntries = entries.flatMap((entry): DropSpot[] => {
			const over = entry.getAttribute("data-entry") ?? undefined;
			const next = movedAcross(sides, active, over);
			if (!next || over === undefined) return [];
			const rect = rectOf(entry);
			const below =
				from === side && list.indexOf(active) < list.indexOf(over as Id);
			return [spot(rect, lineAt(rect, below), next)];
		});
		const toEnd = movedAcross(sides, active, sideTarget(side));
		const last = entries.at(-1);
		const whole = rectOf(element);
		const onSide: DropSpot[] = toEnd
			? [spot(whole, last ? lineAt(rectOf(last), true) : whole, toEnd)]
			: [];
		return [...onEntries, ...onSide];
	});
}

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
	const kind = `sides${useId()}`;
	const reduced = usePrefersReducedMotion();
	const [dropped, setDropped] = useState<Dropped<Side, Id>>();
	const held = stillAwaiting(given, dropped);
	if (held !== dropped) setDropped(held);
	const settled = awaitingSides(given, held);
	const [live, setLive] = useState<Sides<Side, Id>>();
	const sides = live ?? settled;
	const shown: MotionId = reduced ? "none" : motion;
	const settle = useCallback(
		(next: Sides<Side, Id>) => {
			setLive(undefined);
			if (sameSides(next, settled)) return;
			setDropped({ next, over: given });
			onMove(next);
		},
		[settled, given, onMove],
	);
	useDropSpots((carried) =>
		carried.kind === kind
			? spotsFor(
					settled,
					kind,
					carried.payload as Id,
					settle,
					shown === "none" ? undefined : setLive,
				)
			: [],
	);
	return (
		<SidesContext
			value={{
				sides,
				kind,
				motion: shown,
				ghost: (id) => overlay(id as Id),
				onPickUp: onPickUp && ((id) => onPickUp(id as Id)),
			}}
		>
			{children}
		</SidesContext>
	);
}

function SideEntry({
	id,
	context,
	className,
	children,
}: {
	id: string;
	context: SidesState;
	className: string;
	children: ReactNode;
}) {
	const carried = useCarried();
	const dragged = carried?.kind === context.kind && carried.payload === id;
	const source = useDragSource(() => ({
		kind: context.kind,
		payload: id,
		ghost: context.ghost(id),
		onPickUp: () => context.onPickUp?.(id),
	}));
	return (
		<div
			{...source}
			data-entry={id}
			data-dragging={dragged}
			className={`outline-none ${className} ${dragged && context.motion !== "none" ? "opacity-40" : ""}`}
		>
			<EntryDragged value={dragged}>{children}</EntryDragged>
		</div>
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
	const order = (context.sides[side] ?? []) as readonly Id[];
	return (
		<div data-sides={context.kind} data-side={side} className={className}>
			{order.map((id, index) => (
				<SideEntry
					key={id}
					id={id}
					context={context}
					className={entryClassName?.(id, index) ?? ""}
				>
					{children(id)}
				</SideEntry>
			))}
		</div>
	);
}
