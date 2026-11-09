import {
	type DragFrame,
	type DragInitContext,
	getElementPositionOrThrow,
	renderStateReadOnly,
} from "../DragBehavior";
import {
	type DragSpec,
	type DragSpecData,
	type DragSpecLike,
	operator,
	resolveDragSpecLike,
} from "../DragSpec";
import {
	Box,
	OutputThumbnail,
	Slot,
	StateThumbnails,
} from "../DragSpecTreeView";
import { ErrorWithJSX } from "../ErrorBoundary";
import {
	CoincidentPointsError,
	type ConvexHullProjection,
	Delaunay,
} from "../math/delaunay";
import { naturalNeighborWeightsFromDelaunay } from "../math/natural-neighbor";
import { Vec2 } from "../math/vec2";
import { DistanceLine, OverlayVis } from "../OverlayVis";
import {
	type Child,
	Operator,
	type OpOverlayVisProps,
	type OpResult,
	type OpTreeViewProps,
} from "../op";
import { emptyBounds, getGlobalBounds } from "../svgx/bounds";
import { path as svgPath } from "../svgx/helpers";
import { getLayeredBounds } from "../svgx/layeredBounds";
import {
	drawLayered,
	findByPathInLayered,
	type LayeredSvgx,
} from "../svgx/layers";
import { lerpLayeredWeighted } from "../svgx/lerp";
import { assert, assertNever } from "../utils/assert";
import { minBy } from "../utils/collections";
import { type Many, manyToArray } from "../utils/flexible-types";
import { ValueView } from "../ValueView";
import { fixedState } from "./fixed";

export type BetweenInterpolation = "delaunay" | "natural-neighbor";

export function between<T extends object>(
	specs: Many<DragSpecLike<T>>,
	options?: BetweenOptions,
): DragSpec<T> {
	const resolved = manyToArray(specs).map(resolveDragSpecLike);
	assert(resolved.length > 0, "between requires at least one state");
	return operator(BetweenOp)(resolved, options);
}

export type BetweenOptions = {
	interpolation?: BetweenInterpolation;
	sharpness?: number;
};

type BetweenRenderedState<T extends object> = {
	state: T;
	layered: LayeredSvgx;
	position: Vec2;
};

class BetweenOp<T extends object> extends Operator<T> {
	readonly name = "between";
	readonly allFixed: boolean;
	readonly branches: Child<T>[];
	renderedStates: BetweenRenderedState<T>[] = [];
	delaunay: Delaunay | undefined;
	projection: ConvexHullProjection | undefined;
	weights = new Map<number, number>();
	closestIndex = -1;
	preview: (() => LayeredSvgx) | undefined;

	constructor(
		ctx: DragInitContext<T>,
		readonly specs: DragSpecData<T>[],
		readonly options: BetweenOptions = {},
	) {
		super(ctx);
		const fixedStates = specs.map((s) => fixedState(s));
		this.allFixed = fixedStates.every((s) => s !== undefined);
		if (this.allFixed) {
			this.branches = [];
			this.renderedStates = fixedStates.map((state) => {
				assert(state !== undefined);
				const layered = renderStateReadOnly(ctx, state);
				return {
					state,
					layered,
					position: getElementPositionOrThrow(ctx, layered),
				};
			});
			this.delaunay = betweenMakeDelaunay(this.renderedStates, ctx);
		} else {
			this.branches = specs.map((s, i) => this.child(String(i), s));
		}
	}

	frame(frame: DragFrame): OpResult<T> {
		if (!this.allFixed) {
			this.renderedStates = this.branches.map((branch) => {
				const result = branch.run(frame);
				const layered = result.preview();
				const position = getElementPositionOrThrow(this.ctx, layered);
				return { state: result.dropState, layered, position };
			});
			this.delaunay = betweenMakeDelaunay(this.renderedStates, this.ctx);
		}
		const renderedStates = this.renderedStates;
		const delaunay = this.delaunay!;
		const projection = delaunay.projectOntoConvexHull(frame.pointer);

		const interpolation = this.options.interpolation ?? "delaunay";
		let weights;
		if (interpolation === "natural-neighbor") {
			weights = naturalNeighborWeights(delaunay, frame, projection);
		} else if (interpolation === "delaunay") {
			weights = delaunayWeights(projection);
		} else {
			assertNever(interpolation);
		}

		const { sharpness } = this.options;
		if (sharpness !== undefined) {
			let totalWeight = 0;
			for (const [key, weight] of weights.entries()) {
				const newWeight = weight ** sharpness;
				weights.set(key, newWeight);
				totalWeight += newWeight;
			}
			for (const [key, weight] of weights.entries()) {
				weights.set(key, weight / totalWeight);
			}
		}

		let previewCache: LayeredSvgx | undefined;
		const preview = () =>
			(previewCache ??= lerpLayeredWeighted(
				renderedStates.map((rs) => rs.layered),
				weights,
			));

		const closest = minBy(renderedStates, (rs) =>
			rs.position.dist(frame.pointer),
		)!;

		this.projection = projection;
		this.weights = weights;
		this.closestIndex = renderedStates.indexOf(closest);
		this.preview = preview;

		let grabPos = Vec2(0);
		for (const [idx, weight] of weights.entries()) {
			grabPos = grabPos.add(renderedStates[idx].position.mul(weight));
		}

		return { preview, dropState: closest.state, gap: projection.dist, grabPos };
	}

	fuzzDropPositions() {
		return this.renderedStates.map((rs) => rs.position);
	}

	treeView(props: OpTreeViewProps) {
		const { path, active, color } = props;
		const { interpolation } = this.options;
		return (
			<Box
				label={`between [${this.specs.length}]${interpolation ? ` (${interpolation})` : ""}`}
				active={active}
				color={color}
				path={path}
			>
				{this.preview && <OutputThumbnail outputPreview={this.preview()} />}
				{this.allFixed ? (
					<Slot label="states">
						<StateThumbnails
							renderedStates={this.renderedStates}
							closestIndex={this.closestIndex}
						/>
					</Slot>
				) : (
					this.branches.map((branch) => branch.treeView(props))
				)}
			</Box>
		);
	}

	overlayVis({ active, opacity }: OpOverlayVisProps) {
		const { projection, delaunay, lastFrame } = this;
		if (!projection || !delaunay || !lastFrame) return null;
		const { pointer } = lastFrame;
		const projDist = pointer.dist(projection.projectedPt);
		return (
			<g>
				{this.branches.map((branch, i) => (
					<OverlayVis key={`sub-${i}`} op={branch.op} active={false} />
				))}
				<g opacity={opacity}>
					{delaunay.triangles().map((tri, i) => {
						const [a, b, c] = tri;
						return (
							<path
								key={`tri-${i}`}
								d={svgPath("M", a.x, a.y, "L", b.x, b.y, "L", c.x, c.y, "Z")}
								stroke="magenta"
								strokeWidth={1}
								fill="magenta"
								fillOpacity={0.05}
							/>
						);
					})}
					{this.renderedStates.map((rs, i) => {
						const w = this.weights.get(i) ?? 0;
						const maxR = 8;
						const r = Math.sqrt(w) * maxR;
						const isDropState = i === this.closestIndex;
						return (
							<g key={`pt-${i}`}>
								<circle
									{...rs.position.cxy()}
									r={isDropState ? maxR : 3}
									fill="none"
									stroke="magenta"
									strokeWidth={1.5}
								/>
								{active && r > 0.5 && (
									<circle {...rs.position.cxy()} r={r} fill="magenta" />
								)}
							</g>
						);
					})}
					<circle
						{...projection.projectedPt.cxy()}
						r={5}
						stroke="magenta"
						strokeWidth={2}
						fill="none"
					/>
					<DistanceLine
						from={pointer}
						to={projection.projectedPt}
						distance={projDist}
					/>
				</g>
			</g>
		);
	}
}

function betweenMakeDelaunay<T extends object>(
	renderedStates: BetweenRenderedState<T>[],
	ctx: DragInitContext<T>,
) {
	try {
		return new Delaunay(renderedStates.map((rs) => rs.position));
	} catch (e) {
		if (e instanceof CoincidentPointsError) {
			const stateA = renderedStates[e.indexA];
			const stateB = renderedStates[e.indexB];

			throw new ErrorWithJSX(
				"Coincident targets detected in d.between",
				<>
					<p style={{ marginBottom: 8, fontStyle: "italic" }}>
						(Quick hint: are you reordering siblings without IDs?)
					</p>
					<p style={{ marginBottom: 8 }}>
						In order to use{" "}
						<span style={{ fontFamily: "monospace" }}>d.between</span>, the
						dragged element must move to distinct locations in each rendered
						state.
					</p>
					<p style={{ marginBottom: 8 }}>
						Here, we are dragging element{" "}
						<span style={{ fontFamily: "monospace" }}>{ctx.draggedPath}</span>.
						Two states put it at the point [{stateA.position.str(", ")}]:
					</p>
					<div
						style={{
							display: "flex",
							gap: 16,
							marginBottom: 8,
							overflow: "hidden",
						}}
					>
						{[stateA, stateB].map((rs, i) => (
							<CoincidentStatePreview
								key={i}
								layered={rs.layered}
								draggedPath={ctx.draggedPath}
								state={rs.state}
							/>
						))}
					</div>
					<p style={{ marginBottom: 8 }}>
						(This is just the first pair of overlaps – other states may also
						cause overlap.)
					</p>
					<p style={{ marginBottom: 8 }}>
						If this isn't caused by reordering siblings without IDs, you may
						have a genuinely ambiguous drag behavior: multiple states bringing
						the dragged element to the same location. (Or maybe you just
						repeated a state?)
					</p>
				</>,
			);
		}
		throw new Error(`Failed to create Delaunay triangulation: ${e}`);
	}
}

function CoincidentStatePreview<T extends object>({
	layered,
	draggedPath,
	state,
}: {
	layered: LayeredSvgx;
	draggedPath: string;
	state: T;
}) {
	const viewBounds = getLayeredBounds(layered);

	const found = findByPathInLayered(draggedPath, layered);
	const draggedBounds = found
		? getGlobalBounds(found.element, found.accumulatedTransform)
		: emptyBounds;

	const pad = 10;
	const vb = viewBounds.empty
		? { minX: 0, minY: 0, maxX: 100, maxY: 100 }
		: viewBounds;
	const viewBox = `${vb.minX - pad} ${vb.minY - pad} ${vb.maxX - vb.minX + pad * 2} ${vb.maxY - vb.minY + pad * 2}`;

	return (
		<div
			style={{
				flex: "1 1 0",
				minWidth: 0,
				overflow: "hidden",
				display: "flex",
				flexDirection: "column",
				gap: 8,
			}}
		>
			<svg
				viewBox={viewBox}
				style={{
					width: "100%",
					maxWidth: 200,
					border: "1px solid #ccc",
					borderRadius: 4,
					background: "#fff",
				}}
			>
				{drawLayered(layered)}
				{!draggedBounds.empty && (
					<rect
						x={draggedBounds.minX - 3}
						y={draggedBounds.minY - 3}
						width={draggedBounds.maxX - draggedBounds.minX + 6}
						height={draggedBounds.maxY - draggedBounds.minY + 6}
						fill="none"
						stroke="#ff0000"
						strokeWidth={2}
						rx={2}
					/>
				)}
			</svg>
			<div style={{ fontStyle: "italic" }}>from</div>
			<ValueView kind="state" value={state} />
		</div>
	);
}

function naturalNeighborWeights(
	delaunay: Delaunay,
	frame: DragFrame,
	projection: ConvexHullProjection,
): Map<number, number> {
	const nniResult = naturalNeighborWeightsFromDelaunay(
		delaunay,
		frame.pointer,
		{ projectOutside: true },
	);

	if (nniResult) {
		return nniResult.weights;
	}

	return delaunayWeights(projection);
}

function delaunayWeights(
	projection: ConvexHullProjection,
): Map<number, number> {
	const weights = new Map<number, number>();
	if (projection.type === "vertex") {
		weights.set(projection.ptIdx, 1);
	} else if (projection.type === "edge") {
		weights.set(projection.ptIdx0, 1 - projection.t);
		weights.set(projection.ptIdx1, projection.t);
	} else {
		const { l0, l1, l2 } = projection.barycentric;
		weights.set(projection.ptIdx0, l0);
		weights.set(projection.ptIdx1, l1);
		weights.set(projection.ptIdx2, l2);
	}
	return weights;
}
