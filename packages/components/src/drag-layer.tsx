"use client";

import {
	type Draggable,
	DraggableRenderer,
	renderStateReadOnly,
	translate,
} from "@repo/dragology";
import {
	createContext,
	type DragEvent,
	type PointerEvent,
	type ReactNode,
	type RefObject,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

const DRAG_AFTER_PX = 4;
const SETTLE_MS = 260;
const HOME = -1;

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface Carried {
	kind: string;
	payload: unknown;
	ghost: ReactNode;
	also?: readonly { kind: string; payload: unknown }[];
}

export function carriedAs(carried: Carried | null, kind: string): boolean {
	return (
		carried !== null &&
		(carried.kind === kind || !!carried.also?.some((as) => as.kind === kind))
	);
}

export interface DropSpot {
	hit: Rect;
	shows?: Rect;
	enter?: () => void;
	leave?: () => void;
	drop: () => void;
}

export type Spotter = (carried: Carried) => DropSpot[];

export interface DragSource extends Carried {
	onPickUp?: () => void;
}

interface Press {
	source: () => DragSource;
	from: Element;
	start: { x: number; y: number };
}

interface Carry {
	carried: Carried;
	spots: DropSpot[];
	from: Rect;
	pointer: { x: number; y: number };
}

interface Layer {
	carried: Carried | null;
	press: (event: PointerEvent<Element>, source: () => DragSource) => void;
	spotters: Set<RefObject<Spotter>>;
}

const LayerContext = createContext<Layer | null>(null);

export function rectOf(element: Element): Rect {
	const { left, top, width, height } = element.getBoundingClientRect();
	return { left, top, width, height };
}

export function within(rect: Rect, x: number, y: number): boolean {
	return (
		x >= rect.left &&
		x <= rect.left + rect.width &&
		y >= rect.top &&
		y <= rect.top + rect.height
	);
}

export function hitAt(rects: readonly Rect[], x: number, y: number): number {
	return rects.findIndex((rect) => within(rect, x, y));
}

function blocksNativeDrag(event: DragEvent) {
	event.preventDefault();
}

export function useDragSource(source: () => DragSource) {
	const layer = useContext(LayerContext);
	const latest = useRef(source);
	latest.current = source;
	const onPointerDown = useCallback(
		(event: PointerEvent<Element>) => {
			if (!layer || event.button !== 0) return;
			event.stopPropagation();
			layer.press(event, () => latest.current());
		},
		[layer],
	);
	return layer
		? { onPointerDown, onDragStart: blocksNativeDrag, draggable: false }
		: {};
}

export function useDropSpots(spotter: Spotter) {
	const layer = useContext(LayerContext);
	const latest = useRef(spotter);
	latest.current = spotter;
	useEffect(() => {
		if (!layer) return;
		layer.spotters.add(latest);
		return () => {
			layer.spotters.delete(latest);
		};
	}, [layer]);
}

export function useCarried(): Carried | null {
	return useContext(LayerContext)?.carried ?? null;
}

function useUnselectable(active: boolean) {
	useEffect(() => {
		if (!active) return;
		const body = document.body.style;
		const was = body.userSelect;
		body.userSelect = "none";
		return () => {
			body.userSelect = was;
		};
	}, [active]);
}

export function DragLayer({ children }: { children: ReactNode }) {
	const [press, setPress] = useState<Press | null>(null);
	const [carry, setCarry] = useState<Carry | null>(null);
	const spotters = useRef(new Set<RefObject<Spotter>>()).current;
	const end = useCallback(() => setCarry(null), []);
	const begin = useCallback(
		(pressed: Press) => {
			const source = pressed.source();
			source.onPickUp?.();
			const from = rectOf(pressed.from);
			requestAnimationFrame(() => {
				const carried: Carried = {
					kind: source.kind,
					payload: source.payload,
					ghost: source.ghost,
					also: source.also,
				};
				const identities = [
					carried,
					...(source.also ?? []).map((as) => ({ ...carried, ...as })),
				];
				const spots = identities.flatMap((identity) =>
					[...spotters].flatMap((spotter) => spotter.current(identity)),
				);
				setCarry({ carried, spots, from, pointer: pressed.start });
			});
		},
		[spotters],
	);
	useEffect(() => {
		if (!press) return;
		const move = (event: globalThis.PointerEvent) => {
			const dx = event.clientX - press.start.x;
			const dy = event.clientY - press.start.y;
			if (dx * dx + dy * dy <= DRAG_AFTER_PX * DRAG_AFTER_PX) return;
			setPress(null);
			begin(press);
		};
		const release = () => setPress(null);
		document.addEventListener("pointermove", move);
		document.addEventListener("pointerup", release);
		document.addEventListener("pointercancel", release);
		return () => {
			document.removeEventListener("pointermove", move);
			document.removeEventListener("pointerup", release);
			document.removeEventListener("pointercancel", release);
		};
	}, [press, begin]);
	useEffect(() => {
		if (!carry) return;
		const cancel = (event: KeyboardEvent) => {
			if (event.key === "Escape") end();
		};
		document.addEventListener("keydown", cancel);
		return () => document.removeEventListener("keydown", cancel);
	}, [carry, end]);
	useUnselectable(press !== null || carry !== null);
	const layer = useMemo<Layer>(
		() => ({
			carried: carry?.carried ?? null,
			press: (event, source) =>
				setPress({
					source,
					from: event.currentTarget,
					start: { x: event.clientX, y: event.clientY },
				}),
			spotters,
		}),
		[carry, spotters],
	);
	return (
		<LayerContext value={layer}>
			{children}
			{carry && <Overlay carry={carry} onEnd={end} />}
		</LayerContext>
	);
}

type At = { at: number };

function Ghost({ children }: { children: ReactNode }) {
	return (
		<div className="pointer-events-none flex h-full w-full cursor-grabbing items-center overflow-hidden rounded-sm bg-bg2 opacity-90 shadow-lg">
			{children}
		</div>
	);
}

function useHovered(spots: readonly DropSpot[]) {
	const current = useRef(HOME);
	const hover = useCallback(
		(at: number) => {
			if (at === current.current) return;
			spots[current.current]?.leave?.();
			current.current = at;
			spots[at]?.enter?.();
		},
		[spots],
	);
	useEffect(() => () => hover(HOME), [hover]);
	return hover;
}

function Overlay({ carry, onEnd }: { carry: Carry; onEnd: () => void }) {
	const [frame, setFrame] = useState<HTMLDivElement | null>(null);
	const geometry = useMemo(() => {
		if (!frame) return null;
		const client = frame.getBoundingClientRect();
		const width = frame.clientWidth;
		const height = frame.clientHeight;
		const scale = client.width === 0 ? 1 : width / client.width;
		const local = (rect: Rect): Rect => ({
			left: (rect.left - client.left) * scale,
			top: (rect.top - client.top) * scale,
			width: rect.width * scale,
			height: rect.height * scale,
		});
		return {
			width,
			height,
			from: local(carry.from),
			hits: carry.spots.map((spot) => local(spot.hit)),
			shows: carry.spots.map((spot) => spot.shows && local(spot.shows)),
			pointer: {
				x: (carry.pointer.x - client.left) * scale,
				y: (carry.pointer.y - client.top) * scale,
			},
		};
	}, [frame, carry]);
	const draggable = useMemo<Draggable<At> | null>(() => {
		if (!geometry) return null;
		const { from, hits, shows } = geometry;
		return ({ state, d }) => {
			const shown = shows[state.at];
			const lands = shown ?? from;
			return (
				<g>
					{shown && (
						<rect
							id="spot"
							x={shown.left}
							y={shown.top}
							width={Math.max(shown.width, 2)}
							height={Math.max(shown.height, 2)}
							rx={3}
							className="fill-accent/15 stroke-2 stroke-accent"
						/>
					)}
					<g
						id="carried"
						transform={translate(lands.left, lands.top)}
						dragologyOnDrag={() =>
							d
								.custom((ctx) => {
									const drawn = new Map<
										number,
										ReturnType<typeof renderStateReadOnly>
									>();
									const draw = (at: number) => {
										const known = drawn.get(at);
										if (known) return known;
										const fresh = renderStateReadOnly(ctx, { at });
										drawn.set(at, fresh);
										return fresh;
									};
									return ({ pointer }) => {
										const hit = hitAt(hits, pointer.x, pointer.y);
										const at = hit < 0 ? HOME : hit;
										return {
											preview: () => draw(at),
											dropState: { at },
											gap: 0,
										};
									};
								})
								.withFloating()
						}
					>
						<rect
							data-grab
							width={from.width}
							height={from.height}
							fill="transparent"
						/>
						<foreignObject
							width={from.width}
							height={from.height}
							overflow="visible"
						>
							<Ghost>{carry.carried.ghost}</Ghost>
						</foreignObject>
					</g>
				</g>
			);
		};
	}, [geometry, carry.carried.ghost]);
	const [state, setState] = useState<At>({ at: HOME });
	const grabbed = useRef(false);
	useEffect(() => {
		if (!frame || !geometry || grabbed.current) return;
		grabbed.current = true;
		const handle = requestAnimationFrame(() => {
			frame.querySelector("[data-grab]")?.dispatchEvent(
				new window.PointerEvent("pointerdown", {
					bubbles: true,
					cancelable: true,
					clientX: carry.pointer.x,
					clientY: carry.pointer.y,
					button: 0,
					buttons: 1,
					pointerId: 1,
					isPrimary: true,
				}),
			);
		});
		return () => {
			cancelAnimationFrame(handle);
			grabbed.current = false;
		};
	}, [frame, geometry, carry.pointer]);
	const hovered = useHovered(carry.spots);
	const onDropState = useCallback(
		(next: At) => {
			setState(next);
			hovered(HOME);
			const spot = carry.spots[next.at];
			if (spot) {
				spot.drop();
				onEnd();
				return;
			}
			setTimeout(onEnd, SETTLE_MS);
		},
		[carry.spots, hovered, onEnd],
	);
	const onDragState = useCallback((next: At) => hovered(next.at), [hovered]);
	return (
		<div
			ref={setFrame}
			data-drag-layer
			className="fixed inset-0 z-50 cursor-grabbing"
		>
			{geometry && draggable && (
				<DraggableRenderer
					draggable={draggable}
					state={state}
					onDropState={onDropState}
					onDragState={onDragState}
					width={geometry.width}
					height={geometry.height}
				/>
			)}
		</div>
	);
}
