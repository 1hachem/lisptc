"use client";

import {
	type Draggable,
	DraggableRenderer,
	type DragSpec,
	type DragStatus,
	translate,
} from "@repo/dragology";
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
type Size = { width: number; height: number };

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
	still: boolean,
): DragSpec<Ordered<Id>> {
	return still
		? d.closest(orders).withDropTransition(false)
		: d.between(orders);
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

function stepOf(code: string, axis: Axis): number {
	const back = axis === "vertical" ? "ArrowUp" : "ArrowLeft";
	const forth = axis === "vertical" ? "ArrowDown" : "ArrowRight";
	if (code === back) return -1;
	if (code === forth) return 1;
	return 0;
}

function useKeyboardReorder<Id extends string>(
	settled: readonly Id[],
	axis: Axis,
	settle: (next: readonly Id[]) => void,
	onPickUp: ((id: Id) => void) | undefined,
) {
	const [held, setHeld] = useState<{ id: Id; order: Id[] }>();
	const onKeyDown = useCallback(
		(id: Id) => (event: KeyboardEvent<HTMLDivElement>) => {
			if (event.code === "Space" || event.code === "Enter") {
				event.preventDefault();
				setHeld(held ? undefined : { id, order: [...settled] });
				if (held) settle(held.order);
				else onPickUp?.(id);
				return;
			}
			if (event.code === "Escape") {
				setHeld(undefined);
				return;
			}
			const step = stepOf(event.code, axis);
			if (!held || held.id !== id || step === 0) return;
			event.preventDefault();
			const from = held.order.indexOf(id);
			const to = Math.max(0, Math.min(held.order.length - 1, from + step));
			setHeld({ id, order: arrayMoved(held.order, from, to) });
		},
		[axis, held, settled, settle, onPickUp],
	);
	return { held, onKeyDown };
}

function useHeights<Id extends string>() {
	const [heights, setHeights] = useState<ReadonlyMap<Id, number>>(new Map());
	const onHeight = useCallback((id: Id, height: number) => {
		setHeights((last) =>
			last.get(id) === height ? last : new Map(last).set(id, height),
		);
	}, []);
	return { heights, onHeight };
}

function useSettledOrder<Id extends string>(
	given: readonly Id[],
	onReorder: (next: Id[]) => void,
) {
	const [dropped, setDropped] = useState<{
		next: readonly Id[];
		over: readonly Id[];
	}>();
	const settled = awaitingOrder(given, dropped);
	const settle = useCallback(
		(next: readonly Id[]) => {
			if (next.join("\0") === settled.join("\0")) return;
			setDropped({ next, over: given });
			onReorder([...next]);
		},
		[settled, given, onReorder],
	);
	return { settled, settle };
}

function useStableOrder<Id extends string>(order: readonly Id[]): Ordered<Id> {
	const key = order.join("\0");
	return useMemo(
		() => ({ order: key ? (key.split("\0") as Id[]) : [] }),
		[key],
	);
}

function usePickUpReport<Id extends string>(
	settled: readonly Id[],
	layerId: (id: Id) => string,
	onPickUp: ((id: Id) => void) | undefined,
) {
	const picked = useRef<string | null>(null);
	return useCallback(
		(status: DragStatus<Ordered<Id>>) => {
			const now =
				status.type === "dragging" ? status.behaviorCtx.draggedId : null;
			if (now !== null && now !== picked.current) {
				const id = settled.find((candidate) => layerId(candidate) === now);
				if (id) onPickUp?.(id);
			}
			picked.current = now;
		},
		[settled, layerId, onPickUp],
	);
}

function extentOf(boxes: readonly Box[], axis: Axis, frame: Size): Size {
	return boxes.reduce(
		(far, box) => ({
			width: Math.max(far.width, box.x + box.width),
			height: Math.max(far.height, box.y + box.height),
		}),
		{ width: frame.width, height: axis === "horizontal" ? frame.height : 0 },
	);
}

interface ListDrawing<Id extends string> {
	axis: Axis;
	frame: Size;
	heights: ReadonlyMap<Id, number>;
	layerId: (id: Id) => string;
	heldId: Id | undefined;
	still: boolean;
	entryClassName: ((id: Id, index: number) => string) | undefined;
	onHeight: (id: Id, height: number) => void;
	onKeyDown: (id: Id) => (event: KeyboardEvent<HTMLDivElement>) => void;
	children: (id: Id) => ReactNode;
}

function listDraggable<Id extends string>(
	drawing: ListDrawing<Id>,
): Draggable<Ordered<Id>> {
	return ({ state, d, draggedId }) => {
		const placed = boxes(
			state.order,
			drawing.axis,
			drawing.frame,
			drawing.heights,
		);
		return (
			<g>
				{state.order.map((id, index) => {
					const box = placed[index] ?? { x: 0, y: 0, width: 0, height: 0 };
					const layer = drawing.layerId(id);
					const dragged = draggedId === layer || drawing.heldId === id;
					return (
						// biome-ignore lint/correctness/useJsxKeyInIterable: dragology reconciles layers by id and rejects a key
						<g
							id={layer}
							transform={translate(box.x, box.y)}
							dragologyZIndex={dragged ? 1 : 0}
							dragologyOnDrag={() =>
								reorderSpec(
									d,
									state.order.map((_, to) => ({
										order: arrayMoved(state.order, index, to),
									})),
									drawing.still,
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
									className={drawing.entryClassName?.(id, index) ?? ""}
									onHeight={drawing.onHeight}
									onKeyDown={drawing.onKeyDown(id)}
								>
									{drawing.children(id)}
								</MeasuredEntry>
							</foreignObject>
						</g>
					);
				})}
			</g>
		);
	};
}

export function SortableTree<Id extends string>({
	order: given,
	onReorder,
	onPickUp,
	axis = "vertical",
	className = "",
	entryClassName,
	children,
}: {
	order: readonly Id[];
	onReorder: (next: Id[]) => void;
	onPickUp?: (id: Id) => void;
	axis?: "vertical" | "horizontal";
	className?: string;
	entryClassName?: (id: Id, index: number) => string;
	children: (id: Id) => ReactNode;
}) {
	const still = usePrefersReducedMotion();
	const prefix = useId().replaceAll(/[^a-zA-Z0-9]/g, "");
	const layerId = useCallback(
		(id: Id) => `${prefix}-${encodeURIComponent(id).replaceAll("%", "_")}`,
		[prefix],
	);
	const { settled, settle } = useSettledOrder(given, onReorder);
	const { held, onKeyDown } = useKeyboardReorder(
		settled,
		axis,
		settle,
		onPickUp,
	);
	const state = useStableOrder(held?.order ?? settled);
	const [frameElement, setFrameElement] = useState<HTMLDivElement | null>(null);
	const frame = useSize(frameElement);
	const { heights, onHeight } = useHeights<Id>();
	const extent = extentOf(
		boxes(state.order, axis, frame, heights),
		axis,
		frame,
	);
	const draggable = useMemo(
		() =>
			listDraggable({
				axis,
				frame,
				heights,
				layerId,
				heldId: held?.id,
				still,
				entryClassName,
				onHeight,
				onKeyDown,
				children,
			}),
		[
			axis,
			frame,
			heights,
			layerId,
			held,
			still,
			entryClassName,
			onHeight,
			onKeyDown,
			children,
		],
	);
	const onDragStatus = usePickUpReport(settled, layerId, onPickUp);
	const onDropState = useCallback(
		(next: Ordered<Id>) => settle(next.order),
		[settle],
	);
	return (
		<div ref={setFrameElement} className={`relative ${className}`}>
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
