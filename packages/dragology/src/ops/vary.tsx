import {
	type DragFrame,
	type DragInitContext,
	getElementPositionCheap,
	getElementPositionOrThrow,
	renderStateReadOnly,
} from "../DragBehavior";
import {
	type DragSpec,
	operator,
	resolveVaryPath,
	type VaryOptions,
	type VaryPath,
} from "../DragSpec";
import { Box, StateThumbnails, truncate } from "../DragSpecTreeView";
import { DistanceMinimizer } from "../math/optimization";
import { Vec2 } from "../math/vec2";
import { DistanceLine } from "../OverlayVis";
import {
	Operator,
	type OpOverlayVisProps,
	type OpResult,
	type OpTreeViewProps,
} from "../op";
import { getAtPath, type PathIn, setAtPath } from "../paths";
import {
	drawLayered,
	type LayeredSvgx,
	layeredMerge,
	layerSvg,
} from "../svgx/layers";
import {
	type Many,
	type ManyReader,
	manyReaderToArray,
	manyToArray,
} from "../utils/flexible-types";

export class VaryMethod<T extends object> {
	vary<S extends T>(
		state: S,
		paramPaths: Many<VaryPath<S>>,
		options?: VaryOptions<S>,
	): DragSpec<T> {
		const paths = manyToArray(paramPaths).map(resolveVaryPath);
		const stateFromParams = (params: number[]) => {
			let s = state;
			for (let i = 0; i < paths.length; i++) {
				s = setAtPath(s, paths[i], params[i]);
			}
			return s;
		};
		return operator(VaryOp<T>)(
			paths.map((path) => getAtPath(state, path)),
			stateFromParams,
			(options ?? {}) as VaryOptions<T>,
			paths as PathIn<T, number>[],
		);
	}
}

export function varyFunc<T extends object>(
	initParams: number[],
	stateFromParams: (params: number[]) => T,
	options?: VaryOptions<T>,
): DragSpec<T> {
	return operator(VaryOp)(
		initParams,
		stateFromParams,
		options ?? {},
		undefined,
	);
}

const VARY_VIS_DURATION = 0.05;
const VARY_VIS_FRACTION = 0.3;

class VaryOp<T extends object> extends Operator<T> {
	readonly name = "vary";
	readonly minimizer: DistanceMinimizer;
	private readonly constraintsFn: ((params: number[]) => number[]) | undefined;
	rendered: { layered: LayeredSvgx; position: Vec2 } | undefined;
	currentParams: number[] = [];
	exploredPositions: Vec2[] | undefined;
	private varyVisLastSwitch = performance.now() / 1000;
	private varyVisSampledParams: number[] | null = null;

	constructor(
		ctx: DragInitContext<T>,
		readonly initParams: number[],
		readonly stateFromParams: (params: number[]) => T,
		readonly options: VaryOptions<T>,
		readonly paramPaths: PathIn<T, number>[] | undefined,
	) {
		super(ctx);
		const { constraint, pin } = options;
		const initialState = stateFromParams(initParams);

		const pinTargets = pin ? manyReaderToArray(pin, initialState) : undefined;
		const constraintWithPin: ManyReader<number, [T]> = pin
			? [
					constraint,
					(s) => {
						const pinCurrent = manyReaderToArray(pin, s);
						return pinCurrent.map((v, i) => [
							v - pinTargets![i],
							pinTargets![i] - v,
						]);
					},
				]
			: constraint;

		const numConstraints = constraintWithPin
			? manyReaderToArray(constraintWithPin, initialState).length
			: 0;

		this.minimizer = new DistanceMinimizer(initParams, numConstraints);
		this.constraintsFn = constraintWithPin
			? (params) =>
					manyReaderToArray(constraintWithPin, stateFromParams(params))
			: undefined;
	}

	frame(frame: DragFrame): OpResult<T> {
		const { ctx, minimizer } = this;
		const getElementPos = (params: number[]): Vec2 => {
			const candidateState = this.stateFromParams(params);
			const pos = getElementPositionCheap(ctx, candidateState);
			return pos ?? Vec2(Infinity, Infinity);
		};
		minimizer.minimize(frame.pointer, getElementPos, {
			constraints: this.constraintsFn,
		});

		let resultParams = minimizer.params;
		if (ctx.debug.varyVisualizer && minimizer.exploredValues.length > 0) {
			const now = performance.now() / 1000;
			if (now - this.varyVisLastSwitch >= VARY_VIS_DURATION) {
				this.varyVisLastSwitch = now;
				const sampleIdx = Math.floor(
					Math.random() * minimizer.exploredValues.length * VARY_VIS_FRACTION,
				);
				this.varyVisSampledParams = minimizer.exploredValues[sampleIdx];
			}
			resultParams =
				this.varyVisSampledParams ??
				minimizer.exploredValues[0] ??
				minimizer.params;
		}

		const newState = this.stateFromParams(resultParams);
		let previewLayered = renderStateReadOnly(ctx, newState);
		const achievedPos = getElementPositionOrThrow(ctx, previewLayered);
		const gap = achievedPos.dist(frame.pointer);

		if (ctx.debug.varyVisualizer) {
			const ghosted = minimizer.exploredValues.map((params) =>
				renderStateReadOnly(ctx, this.stateFromParams(params)),
			);
			previewLayered = layeredMerge(
				previewLayered,
				layerSvg(
					<g id="vary-cloud" dragologyZIndex="/-100" dragologyOpaque={true}>
						{ghosted.map((g, i) => (
							<g key={`explored-${i}`} opacity={0.15}>
								{drawLayered(g)}
							</g>
						))}
					</g>,
				),
			);
		}

		this.rendered = { layered: previewLayered, position: achievedPos };
		this.currentParams = resultParams.slice();
		this.exploredPositions = ctx.debug.varyVisualizer
			? minimizer.exploredPositions.slice()
			: undefined;

		return {
			preview: () => previewLayered,
			dropState: newState,
			gap,
			grabPos: achievedPos,
		};
	}

	fuzzDropPositions() {
		return this.rendered ? [this.rendered.position] : [];
	}

	treeView({ path, active, color }: OpTreeViewProps) {
		const label = this.paramPaths
			? `vary [${this.paramPaths.map((p) => p.join(".")).join(", ")}]`
			: `varyFunc [${this.initParams.length} params]`;
		const constraintSrc = this.options.constraint
			? truncate(this.options.constraint.toString(), 60)
			: null;
		return (
			<Box label={label} active={active} color={color} path={path}>
				{constraintSrc && (
					<div
						style={{
							fontSize: 9,
							color: "rgb(120, 113, 108)",
							background: "rgba(0,0,0,0.04)",
							borderRadius: 3,
							padding: "2px 4px",
							whiteSpace: "pre-wrap",
							wordBreak: "break-all",
						}}
					>
						constraint: {constraintSrc}
					</div>
				)}
				{this.rendered && <StateThumbnails renderedStates={[this.rendered]} />}
			</Box>
		);
	}

	overlayVis({ opacity }: OpOverlayVisProps) {
		if (!this.rendered || !this.lastFrame) return null;
		const { pointer } = this.lastFrame;
		const pos = this.rendered.position;
		const distance = pointer.dist(pos);
		return (
			<g opacity={opacity}>
				{this.exploredPositions?.map((ep, i) => (
					<line
						key={i}
						{...ep.xy1()}
						{...pointer.xy2()}
						stroke="magenta"
						strokeWidth={0.5}
						opacity={0.5}
					/>
				))}
				{this.exploredPositions?.map((ep, i) => (
					<circle
						key={`c${i}`}
						{...ep.cxy()}
						r={2}
						fill="magenta"
						opacity={0.5}
					/>
				))}
				<circle {...pos.cxy()} r={5} fill="magenta" />
				<DistanceLine from={pos} to={pointer} distance={distance} />
			</g>
		);
	}
}
