"use client";

import {
	type Draggable,
	DraggableRenderer,
	type DragSpec,
	type DragStatus,
	translate,
} from "@repo/dragology";
import type { MotionId } from "@repo/ui/motions.ts";
import {
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	awaitingOrder,
	EntryDragged,
	usePrefersReducedMotion,
} from "./sortable-tree.tsx";

const DRAG_AFTER_PX = 4;
const UNMEASURED_ROW_PX = 24;
const SORTABLE = {
	role: "button",
	"aria-roledescription": "sortable",
	tabIndex: 0,
} as const;

type Axis = "vertical" | "horizontal";
type Ordered<Id extends string> = { order: Id[] };
type Box = { x: number; y: number; width: number; height: number };

function boxes<Id extends string>(
	order: readonly Id[],
	axis: Axis,
	frame: { width: number; height: number },
	heights: ReadonlyMap<Id, number>,
): Box[] {
	if (axis === "horizontal") {
		const width = order.length ? frame.width / order.length : 0;
		return order.map((_, index) => ({
			x: index * width,
			y: 0,
			width,
			height: frame.height,
		}));
	}
	let y = 0;
	return order.map((id) => {
		const height = heights.get(id) ?? UNMEASURED_ROW_PX;
		const box = { x: 0, y, width: frame.width, height };
		y += height;
		return box;
	});
}

function arrayMoved<Id>(order: readonly Id[], from: number, to: number): Id[] {
	const next = [...order];
	const [picked] = next.splice(from, 1);
	if (picked !== undefined) next.splice(to, 0, picked);
	return next;
}

function reorderSpec<Id extends string>(
	d: Parameters<Draggable<Ordered<Id>>>[0]["d"],
	orders: Ordered<Id>[],
	motion: MotionId,
): DragSpec<Ordered<Id>> {
	if (motion === "slide") return d.between(orders);
	if (motion === "none") return d.closest(orders).withDropTransition(false);
	return d
		.closest(orders)
		.withFloating(motion === "overlay" ? { ghost: true } : {});
}

function useSize(element: HTMLElement | null) {
	const [size, setSize] = useState({ width: 0, height: 0 });
	useEffect(() => {
		if (!element || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(([entry]) => {
			if (!entry) return;
			const { width, height } = entry.contentRect;
			setSize((last) =>
				last.width === width && last.height === height
					? last
					: { width, height },
			);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);
	return size;
}

function MeasuredEntry<Id extends string>({
	id,
	dragged,
	className,
	onHeight,
	onKeyDown,
	children,
}: {
	id: Id;
	dragged: boolean;
	className: string;
	onHeight: (id: Id, height: number) => void;
	onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
	children: ReactNode;
}) {
	const [element, setElement] = useState<HTMLDivElement | null>(null);
	const { height } = useSize(element);
	useEffect(() => {
		if (height > 0) onHeight(id, height);
	}, [id, height, onHeight]);
	return (
		<div
			ref={setElement}
			{...SORTABLE}
			{...{ "aria-pressed": dragged, onKeyDown }}
			data-entry={id}
			data-dragging={dragged}
			className={`outline-none focus-visible:bg-bg2 ${className} ${
				dragged ? "cursor-grabbing bg-bg2" : ""
			}`}
		>
			<EntryDragged value={dragged}>{children}</EntryDragged>
		</div>
	);
}

export function SortableTree<Id extends string>({
	order: given,
	onReorder,
	onPickUp,
	motion = "slide",
	axis = "vertical",
	className = "",
	entryClassName,
	children,
}: {
	order: readonly Id[];
	onReorder: (next: Id[]) => void;
	onPickUp?: (id: Id) => void;
	motion?: MotionId;
	axis?: Axis;
	className?: string;
	entryClassName?: (id: Id, index: number) => string;
	children: (id: Id) => ReactNode;
}) {
	const reduced = usePrefersReducedMotion();
	const shown: MotionId = reduced ? "none" : motion;
	const prefix = useId().replaceAll(/[^a-zA-Z0-9]/g, "");
	const [dropped, setDropped] = useState<{
		next: readonly Id[];
		over: readonly Id[];
	}>();
	const [held, setHeld] = useState<{ id: Id; order: Id[] }>();
	const settled = awaitingOrder(given, dropped);
	const order = held?.order ?? settled;
	const orderKey = order.join("\0");
	const state = useMemo<Ordered<Id>>(
		() => ({ order: orderKey ? (orderKey.split("\0") as Id[]) : [] }),
		[orderKey],
	);
	const [frameElement, setFrameElement] = useState<HTMLDivElement | null>(null);
	const frame = useSize(frameElement);
	const [heights, setHeights] = useState<ReadonlyMap<Id, number>>(new Map());
	const onHeight = useCallback((id: Id, height: number) => {
		setHeights((last) =>
			last.get(id) === height ? last : new Map(last).set(id, height),
		);
	}, []);
	const layerId = useCallback(
		(id: Id) => `${prefix}-${encodeURIComponent(id).replaceAll("%", "_")}`,
		[prefix],
	);
	const settle = useCallback(
		(next: readonly Id[]) => {
			const changed = next.join("\0") !== settled.join("\0");
			if (!changed) return;
			setDropped({ next, over: given });
			onReorder([...next]);
		},
		[settled, given, onReorder],
	);
	const onKeyDown = useCallback(
		(id: Id) => (event: KeyboardEvent<HTMLDivElement>) => {
			if (event.code === "Space" || event.code === "Enter") {
				event.preventDefault();
				if (!held) {
					setHeld({ id, order: [...settled] });
					onPickUp?.(id);
					return;
				}
				setHeld(undefined);
				settle(held.order);
				return;
			}
			if (event.code === "Escape" && held) {
				setHeld(undefined);
				return;
			}
			const step =
				event.code === (axis === "vertical" ? "ArrowUp" : "ArrowLeft")
					? -1
					: event.code === (axis === "vertical" ? "ArrowDown" : "ArrowRight")
						? 1
						: 0;
			if (!held || held.id !== id || step === 0) return;
			event.preventDefault();
			const from = held.order.indexOf(id);
			const to = Math.max(0, Math.min(held.order.length - 1, from + step));
			setHeld({ id, order: arrayMoved(held.order, from, to) });
		},
		[axis, held, settled, settle, onPickUp],
	);
	const laidOut = boxes(state.order, axis, frame, heights);
	const extent = laidOut.reduce(
		(far, box) => ({
			width: Math.max(far.width, box.x + box.width),
			height: Math.max(far.height, box.y + box.height),
		}),
		{ width: frame.width, height: axis === "horizontal" ? frame.height : 0 },
	);
	const draggable = useMemo<Draggable<Ordered<Id>>>(
		() =>
			({ state: drawn, d, draggedId }) => {
				const placed = boxes(drawn.order, axis, frame, heights);
				return (
					<g>
						{drawn.order.map((id, index) => {
							const box = placed[index] ?? { x: 0, y: 0, width: 0, height: 0 };
							const layer = layerId(id);
							const dragged = draggedId === layer || held?.id === id;
							return (
								// biome-ignore lint/correctness/useJsxKeyInIterable: dragology reconciles layers by id and rejects a key
								<g
									id={layer}
									transform={translate(box.x, box.y)}
									dragologyZIndex={dragged ? 1 : 0}
									dragologyOnDrag={() =>
										reorderSpec(
											d,
											drawn.order.map((_, to) => ({
												order: arrayMoved(drawn.order, index, to),
											})),
											shown,
										)
									}
								>
									<rect width={box.width} height={box.height} fill="none" />
									<foreignObject
										width={box.width}
										height={box.height}
										overflow="visible"
									>
										<MeasuredEntry
											id={id}
											dragged={dragged}
											className={entryClassName?.(id, index) ?? ""}
											onHeight={onHeight}
											onKeyDown={onKeyDown(id)}
										>
											{children(id)}
										</MeasuredEntry>
									</foreignObject>
								</g>
							);
						})}
					</g>
				);
			},
		[
			axis,
			frame,
			heights,
			layerId,
			held,
			shown,
			entryClassName,
			onHeight,
			onKeyDown,
			children,
		],
	);
	const picked = useRef<string | null>(null);
	const onDragStatus = useCallback(
		(status: DragStatus<Ordered<Id>>) => {
			const now =
				status.type === "dragging" ? status.behaviorCtx.draggedId : null;
			if (now !== picked.current && now !== null) {
				const id = settled.find((candidate) => layerId(candidate) === now);
				if (id) onPickUp?.(id);
			}
			picked.current = now;
		},
		[settled, layerId, onPickUp],
	);
	const onDropState = useCallback(
		(next: Ordered<Id>) => settle(next.order),
		[settle],
	);
	return (
		<div
			ref={setFrameElement}
			data-motion={shown}
			className={`relative ${className}`}
		>
			<DraggableRenderer
				draggable={draggable}
				state={state}
				onDropState={onDropState}
				onDragStatus={onDragStatus}
				dragThreshold={DRAG_AFTER_PX}
				width={extent.width}
				height={extent.height}
			/>
		</div>
	);
}
