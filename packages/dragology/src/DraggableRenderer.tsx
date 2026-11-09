import type React from "react";
import {
	type SetStateAction,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type DragBehavior,
	type DragFrame,
	type DragInitContext,
	type DragResult,
	dragSpecToBehavior,
} from "./DragBehavior";
import type { DragSpec } from "./DragSpec";
import {
	type Draggable,
	getOnDragCallbackOnElement,
	makeDraggableProps,
} from "./draggable";
import { ErrorBoundary } from "./ErrorBoundary";
import { Vec2, type Vec2able } from "./math/vec2";
import { OverlayVis } from "./OverlayVis";
import {
	renderDraggableInert,
	renderDraggableInertUnlayered,
} from "./renderDraggable";
import { findElement, type Svgx, updatePropsDownTree } from "./svgx";
import { boundsCenter, getLocalBounds } from "./svgx/bounds";
import { ComponentHost } from "./svgx/componentHost";
import { drawLayered, type LayeredSvgx, layerSvg } from "./svgx/layers";
import { lerpLayered } from "./svgx/lerp";
import { assignPaths, findByPath, getPath } from "./svgx/path";
import { globalToLocal, localToGlobal } from "./svgx/transform";
import {
	applyEasing,
	resolveTransitionLike,
	type Transition,
	type TransitionLike,
} from "./transition";
import { useAnimationLoop } from "./useAnimationLoop";
import {
	type CatchToRenderError,
	useCatchToRenderError,
} from "./useRenderError";
import { useStateWithRef } from "./useStateWithRef";
import { assert } from "./utils/assert";
import { isEqual } from "./utils/collections";
import { pipe } from "./utils/pipe";

type SpringOrigin = {
	layered: LayeredSvgx;
	time: number;
	transition: Transition;
};

function makeSpringOrigin(
	transitionLike: TransitionLike,
	layeredLazy: () => LayeredSvgx,
): SpringOrigin | null {
	const transition = resolveTransitionLike(transitionLike);
	if (transition === false) return null;
	return {
		layered: layeredLazy(),
		time: performance.now(),
		transition,
	};
}

type PendingDrag<T extends object> = {
	startClientPos: Vec2;
	threshold: number;
	status: DragStatusDragging<T>;
};

export type DragStatus<T extends object> = {
	springOrigin: SpringOrigin | null;
} & (
	| { type: "idle"; state: T; pendingDrag?: PendingDrag<T> }
	| {
			type: "dragging";
			startState: T;
			behavior: DragBehavior<T>;
			behaviorCtx: DragInitContext<T>;
			result: DragResult<T>;
			specForDropZoneVis: DragSpec<T>;
	  }
);
type DragStatusDragging<T extends object> = DragStatus<T> & {
	type: "dragging";
};

export interface DraggableRendererBaseProps<T extends object> {
	draggable: Draggable<T>;
	width?: number;
	height?: number;
	onDropState?: (state: T) => void;
	onDragState?: (state: T) => void;
	onDragStatus?: (dragStatus: DragStatus<T>) => void;
	showDebugOverlay?: boolean;
	showVaryVisualizer?: boolean;
	dragThreshold?: number;
	simulateDrag?: { id: string; offset?: Vec2able };
}

export type DraggableRendererProps<T extends object> =
	DraggableRendererBaseProps<T> &
		(
			| { state: NoInfer<T>; initialState?: undefined }
			| { state?: undefined; initialState: NoInfer<T> }
		);

export function DraggableRenderer<T extends object>({
	state,
	initialState,
	...rest
}: DraggableRendererProps<T>) {
	assert(
		!(state !== undefined && initialState !== undefined),
		"DraggableRenderer: provide either 'state' or 'initialState', not both",
	);
	if (state !== undefined) {
		return <DraggableRendererControlled {...rest} state={state} />;
	}
	return (
		<DraggableRendererUncontrolled {...rest} initialState={initialState!} />
	);
}

function DraggableRendererUncontrolled<T extends object>({
	initialState,
	onDropState,
	...rest
}: DraggableRendererBaseProps<T> & { initialState: T }) {
	const [state, setState] = useState(initialState);
	const handleStateChange = useCallback(
		(newState: T) => {
			setState(newState);
			onDropState?.(newState);
		},
		[onDropState],
	);
	return (
		<DraggableRendererControlled
			{...rest}
			state={state}
			onDropState={handleStateChange}
		/>
	);
}

function DraggableRendererControlled<T extends object>({
	draggable,
	state,
	width,
	height,
	onDropState,
	onDragState,
	onDragStatus,
	showDebugOverlay,
	showVaryVisualizer,
	dragThreshold = 2,
	simulateDrag,
}: DraggableRendererBaseProps<T> & { state: T }) {
	const catchToRenderError = useCatchToRenderError();

	const [status, setStatus, statusRef] = useStateWithRef<DragStatus<T>>({
		type: "idle",
		state,
		springOrigin: null,
	});

	if (status.type === "idle" && status.state !== state) {
		const currentRendered = renderDraggableInert(
			draggable,
			status.state,
			null,
			false,
		);
		const currentVisual = runSpring(status.springOrigin, currentRendered);
		setStatus({
			...status,
			state,
			springOrigin: makeSpringOrigin(true, () => currentVisual),
		});
	}

	useEffect(() => {
		onDragStatus?.(status);
	}, [status, onDragStatus]);

	const prevDropStateRef = useRef<T | undefined>(undefined);
	useLayoutEffect(() => {
		const dropState =
			status.type === "dragging" ? status.result.dropState : undefined;
		if (dropState !== undefined && dropState !== prevDropStateRef.current) {
			onDragState?.(dropState);
		}
		prevDropStateRef.current = dropState;
	}, [status, onDragState]);

	const pointerRef = useRef<Vec2 | undefined>(undefined);
	const pointerOverrideRef = useRef<Vec2 | undefined>(undefined);
	const getPointer = () => pointerOverrideRef.current ?? pointerRef.current;
	const onDropStateRef = useRef(onDropState);
	onDropStateRef.current = onDropState;
	const onDragStateRef = useRef(onDragState);
	onDragStateRef.current = onDragState;

	const suppressClickRef = useRef(false);

	const [svgElem, setSvgElem] = useState<SVGSVGElement | null>(null);

	const setPointerFromEvent = useCallback(
		(e: globalThis.PointerEvent) => {
			assert(!!svgElem);
			const rect = svgElem.getBoundingClientRect();
			const scale =
				svgElem.width.baseVal.value !== 0
					? rect.width / svgElem.width.baseVal.value
					: 1;
			const pointer = Vec2(
				(e.clientX - rect.left) / scale,
				(e.clientY - rect.top) / scale,
			);
			pointerRef.current = pointer;
			return pointer;
		},
		[svgElem],
	);

	useAnimationLoop(
		catchToRenderError(() => {
			const result = advanceFrame(
				statusRef.current,
				getPointer(),
				performance.now(),
			);
			if (result) {
				setStatus(result);
			}
		}),
	);

	if (simulateDrag && status.type === "idle" && !status.pendingDrag) {
		const simId = simulateDrag.id;
		const simOffset = simulateDrag.offset
			? Vec2(simulateDrag.offset)
			: Vec2(0, 0);
		const content = renderDraggableInertUnlayered(
			draggable,
			state,
			simId,
			true,
		);
		const found = findElement(content, (el) => el.props.id === simId);
		if (found) {
			const localBounds = getLocalBounds(found.element);
			if (!localBounds.empty) {
				const center = boundsCenter(localBounds);
				const pointer = localToGlobal(found.accumulatedTransform, center).add(
					simOffset,
				);
				pointerOverrideRef.current = pointer;

				const dragSpec = getOnDragCallbackOnElement<T>(found.element)?.();
				const draggedPath = getPath(found.element);
				if (dragSpec && draggedPath) {
					const behaviorCtx: DragInitContext<T> = {
						draggable,
						draggedPath,
						draggedId: simId,
						anchorPos: center,
						startState: state,
						debug: { varyVisualizer: false },
					};
					const frame: DragFrame = { pointer };
					setStatus(initDrag(dragSpec, behaviorCtx, state, frame, null));
				}
			}
		}
	}

	useEffect(() => {
		document.body.style.cursor =
			status.type === "dragging" ? "grabbing" : "default";
	}, [status.type]);

	const shouldListenToPointer =
		!simulateDrag &&
		(status.type === "dragging" ||
			(status.type === "idle" && !!status.pendingDrag));
	useEffect(() => {
		if (!shouldListenToPointer) return;

		const onPointerMove = catchToRenderError((e: globalThis.PointerEvent) => {
			const status = statusRef.current;
			if (status.type === "idle" && status.pendingDrag) {
				const { pendingDrag: pending } = status;
				const clientPos = Vec2(e.clientX, e.clientY);
				const d = clientPos.sub(pending.startClientPos);
				if (d.len2() > pending.threshold * pending.threshold) {
					setPointerFromEvent(e);
					setStatus(pending.status);
				}
			} else {
				setPointerFromEvent(e);
			}
		});

		const onPointerUp = catchToRenderError((e: globalThis.PointerEvent) => {
			const status = statusRef.current;
			if (status.type === "idle" && status.pendingDrag) {
				const newState: DragStatus<T> = {
					type: "idle",
					state: status.state,
					springOrigin: status.springOrigin,
				};
				setStatus(newState);
				return;
			}

			if (status.type !== "dragging") return;
			suppressClickRef.current = true;
			const pointer = setPointerFromEvent(e);

			const frame: DragFrame = { pointer };
			const result = status.behavior(frame);
			const dropState = result.dropState;

			const newState: DragStatus<T> = {
				type: "idle",
				state: dropState,
				springOrigin: makeSpringOrigin(result.dropTransition, () =>
					runSpring(status.springOrigin, result.preview()),
				),
			};
			setStatus(newState);
			onDropStateRef.current?.(dropState);
			onDragStateRef.current?.(dropState);
		});

		document.addEventListener("pointermove", onPointerMove);
		document.addEventListener("pointerup", onPointerUp);
		return () => {
			document.removeEventListener("pointermove", onPointerMove);
			document.removeEventListener("pointerup", onPointerUp);
		};
	}, [
		catchToRenderError,
		statusRef,
		shouldListenToPointer,
		setStatus,
		setPointerFromEvent,
	]);

	const renderCtx: RenderContext<T> = useMemo(
		() => ({
			draggable,
			catchToRenderError,
			setPointerFromEvent,
			setStatus,
			onDropState,
			dragThreshold,
			showVaryVisualizer: showVaryVisualizer ?? false,
			showDebugOverlay: showDebugOverlay ?? false,
		}),
		[
			catchToRenderError,
			draggable,
			dragThreshold,
			onDropState,
			setStatus,
			setPointerFromEvent,
			showVaryVisualizer,
			showDebugOverlay,
		],
	);

	const componentHost = useRef<ComponentHost | null>(null);
	componentHost.current ??= new ComponentHost();
	const drawn = useMemo(() => {
		const { layered, portals } = componentHost.current!.frame(
			status.type === "idle"
				? renderIdleMode(status, renderCtx)
				: runSpring(status.springOrigin, status.result.preview()),
			status.type === "dragging",
		);
		return { layers: drawLayered(layered), portals };
	}, [status, renderCtx]);
	const pointer = getPointer();

	return (
		<svg
			ref={setSvgElem}
			width={width}
			height={height}
			xmlns="http://www.w3.org/2000/svg"
			style={{
				overflow: "visible",
				userSelect: "none",
				touchAction: "none",
				...(simulateDrag ? { pointerEvents: "none" } : {}),
			}}
			onPointerDownCapture={() => {
				suppressClickRef.current = false;
			}}
			onClickCapture={(e) => {
				if (!suppressClickRef.current) return;
				suppressClickRef.current = false;
				e.stopPropagation();
				e.preventDefault();
			}}
		>
			{drawn.layers}
			{drawn.portals}
			{status.type === "dragging" && showDebugOverlay && pointer && (
				<ErrorBoundary>
					<OverlayVis op={status.result.op} />
				</ErrorBoundary>
			)}
			{simulateDrag && pointerOverrideRef.current && (
				<circle
					cx={pointerOverrideRef.current.x}
					cy={pointerOverrideRef.current.y}
					r={4}
					fill="red"
					stroke="white"
					strokeWidth={1.5}
					opacity={0.8}
				/>
			)}
		</svg>
	);
}

function runSpring(
	springOrigin: SpringOrigin | null,
	target: LayeredSvgx,
): LayeredSvgx {
	if (!springOrigin) return target;
	const elapsed = performance.now() - springOrigin.time;
	const t = applyEasing(springOrigin.transition, elapsed);
	const lerped = lerpLayered(target, springOrigin.layered, 1 - t, "a");
	for (const [key, layer] of lerped.byId.entries()) {
		if (layer.element.props["dragologyTransition"] === false) {
			const targetVal = target.byId.get(key);
			if (targetVal) {
				lerped.byId.set(key, targetVal);
			}
		}
	}
	return lerped;
}

function advanceFrame<T extends object>(
	status: DragStatus<T>,
	pointer: Vec2 | undefined,
	now: number,
): DragStatus<T> | null {
	if (status.type === "dragging") {
		if (!pointer) return null;
		const frame: DragFrame = { pointer };
		const result = status.behavior(frame);

		const chained = resolveChainNows(status, frame, result);
		if (chained !== status) return chained;

		let springOrigin = status.springOrigin;

		if (result.activePath !== status.result.activePath) {
			springOrigin = makeSpringOrigin(result.activePathTransition, () =>
				runSpring(springOrigin, status.result.preview()),
			);
		}

		if (
			springOrigin &&
			now - springOrigin.time >= springOrigin.transition?.duration!
		) {
			springOrigin = null;
		}

		return { ...status, result, springOrigin };
	}

	if (status.type === "idle" && status.springOrigin) {
		if (
			now - status.springOrigin.time >=
			status.springOrigin.transition.duration
		) {
			return { ...status, springOrigin: null };
		}
		return { ...status };
	}

	return null;
}

function resolveChainNows<T extends object>(
	status: DragStatusDragging<T>,
	frame: DragFrame,
	result: DragResult<T>,
): DragStatusDragging<T> {
	if (!result.chainNow || isEqual(result.dropState, status.startState))
		return status;

	const newState = result.dropState;
	const newDraggedId =
		result.chainNow.draggedId ?? status.behaviorCtx.draggedId;
	const content = renderDraggableInertUnlayered(
		status.behaviorCtx.draggable,
		newState,
		newDraggedId,
		true,
	);
	const found = newDraggedId
		? findElement(content, (el) => el.props.id === newDraggedId)
		: findByPath(status.behaviorCtx.draggedPath, content);

	assert(
		!!found,
		`Chained drag must have a valid dragged element; couldn't find element with id ${newDraggedId}`,
	);

	const newDragSpec =
		result.chainNow.followSpec ??
		getOnDragCallbackOnElement<T>(found.element)?.();
	if (!newDragSpec) return status;

	const chainTransition = result.chainNow.transition;
	const newSpringOrigin = makeSpringOrigin(chainTransition, () =>
		runSpring(status.springOrigin, status.result.preview()),
	);

	const newDraggedPath = getPath(found.element);
	assert(!!newDraggedPath, "Chained element must have a path");

	const anchorPos = status.behaviorCtx.anchorPos;

	return initDrag(
		newDragSpec,
		{
			...status.behaviorCtx,
			draggedPath: newDraggedPath,
			draggedId: newDraggedId,
			anchorPos,
			startState: newState,
		},
		newState,
		frame,
		newSpringOrigin,
	);
}

function initDrag<T extends object>(
	spec: DragSpec<T>,
	behaviorCtx: DragInitContext<T>,
	state: T,
	frame: DragFrame,
	springOrigin: SpringOrigin | null,
): DragStatusDragging<T> {
	const behavior = dragSpecToBehavior(spec, behaviorCtx);
	const result = behavior(frame);

	const status: DragStatusDragging<T> = {
		type: "dragging",
		startState: state,
		behavior,
		specForDropZoneVis: spec,
		behaviorCtx,
		result,
		springOrigin,
	};

	return status;
}

type RenderContext<T extends object> = {
	draggable: Draggable<T>;
	catchToRenderError: CatchToRenderError;
	setPointerFromEvent: (e: globalThis.PointerEvent) => Vec2;
	setStatus: (ds: DragStatus<T>) => void;
	onDropState?: (state: T) => void;
	dragThreshold: number;
	showVaryVisualizer: boolean;
	showDebugOverlay: boolean;
};

function ancestorOrSelfHasClickHandler(
	root: Svgx,
	targetPath: string,
): boolean {
	const found = findByPath(targetPath, root);
	if (!found) return false;
	return [...found.ancestors, found.element].some(
		(el) => el.props.onClick || el.props.onDoubleClick,
	);
}

function postProcessForInteraction<T extends object>(
	content: Svgx,
	state: T,
	ctx: RenderContext<T>,
): LayeredSvgx {
	const withPaths = assignPaths(content);
	return pipe(
		withPaths,
		(el) =>
			updatePropsDownTree(el, (el) => {
				const onDragCallback = getOnDragCallbackOnElement<T>(el);
				if (!onDragCallback) return;
				assert(
					!el.props.onPointerDown,
					"Elements with dragology cannot have onPointerDown (it is overwritten)",
				);
				return {
					style: { cursor: "grab", ...(el.props.style || {}) },
					onPointerDown: ctx.catchToRenderError((e: React.PointerEvent) => {
						e.stopPropagation();
						const pointer = ctx.setPointerFromEvent(e.nativeEvent);

						const dragSpec: DragSpec<T> = onDragCallback();
						const draggedId = el.props.id ?? null;
						const draggedPath = getPath(el);
						assert(!!draggedPath, "Dragged element must have a path");

						const found = findByPath(draggedPath, withPaths);
						assert(!!found, "Dragged element must be findable by path");
						const anchorPos = globalToLocal(
							found.accumulatedTransform,
							pointer,
						);

						const behaviorCtx: DragInitContext<T> = {
							draggable: ctx.draggable,
							draggedPath,
							draggedId,
							anchorPos,
							startState: state,
							debug: { varyVisualizer: ctx.showVaryVisualizer },
						};

						const frame: DragFrame = { pointer };
						const draggingStatus = initDrag(
							dragSpec,
							behaviorCtx,
							state,
							frame,
							null,
						);

						const pressedHostedHtml = e.target instanceof HTMLElement;
						const hasClickHandler =
							pressedHostedHtml ||
							ancestorOrSelfHasClickHandler(withPaths, draggedPath);

						if (ctx.dragThreshold <= 0 || !hasClickHandler) {
							ctx.setStatus(draggingStatus);
						} else {
							ctx.setStatus({
								type: "idle",
								state,
								springOrigin: null,
								pendingDrag: {
									startClientPos: Vec2(e.clientX, e.clientY),
									threshold: ctx.dragThreshold,
									status: draggingStatus,
								},
							});
						}
					}),
				};
			}),
		layerSvg,
	);
}

function renderIdleMode<T extends object>(
	status: DragStatus<T> & { type: "idle" },
	ctx: RenderContext<T>,
): LayeredSvgx {
	const content = ctx.draggable(
		makeDraggableProps({
			state: status.state,
			draggedId: null,
			setState: ctx.catchToRenderError(
				(
					newState: SetStateAction<T>,
					{ transition }: { transition?: TransitionLike } = {},
				) => {
					const resolved =
						typeof newState === "function"
							? (newState as (prev: T) => T)(status.state)
							: newState;
					const newStatus: DragStatus<T> = {
						type: "idle",
						state: resolved,
						springOrigin: makeSpringOrigin(transition, () =>
							renderDraggableInert(ctx.draggable, status.state, null, false),
						),
					};
					ctx.setStatus(newStatus);
					ctx.onDropState?.(resolved);
				},
			),
			isTracking: false,
		}),
	);

	const layered = postProcessForInteraction(content, status.state, ctx);
	return runSpring(status.springOrigin, layered);
}
