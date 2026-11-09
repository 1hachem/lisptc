import type { DragFrame, DragInitContext } from "../DragBehavior";
import { type DragSpec, type DragSpecData, operator } from "../DragSpec";
import { Box, OutputThumbnail } from "../DragSpecTreeView";
import { Vec2 } from "../math/vec2";
import { DistanceLine, OverlayVis } from "../OverlayVis";
import {
	Modifier,
	type OpOverlayVisProps,
	type OpResult,
	type OpTreeViewProps,
} from "../op";
import { renderDraggableInert } from "../renderDraggable";
import type { SvgxProps } from "../svgx";
import { translate } from "../svgx/helpers";
import {
	type LayeredSvgx,
	layeredExtract,
	layeredMerge,
	layeredPrefixIds,
	layeredSetAttributes,
	layeredShiftZIndices,
	layeredTransform,
} from "../svgx/layers";
import { localToGlobal } from "../svgx/transform";
import { assert } from "../utils/assert";
import { pipe } from "../utils/pipe";

export type FloatingOptions = {
	ghost?: SvgxProps | true;
	tether?: (dist: number) => number;
};

export function withFloating<T extends object>(
	this: DragSpec<T>,
	{ ghost, tether }: FloatingOptions = {},
): DragSpec<T> {
	return operator(WithFloatingOp)(
		this,
		ghost === true ? { opacity: 0.5 } : ghost,
		tether,
	);
}

class WithFloatingOp<T extends object> extends Modifier<T> {
	readonly name = "withFloating";
	readonly draggedId: string;
	private cachedFloatAnchored: LayeredSvgx | null = null;
	private computed:
		| (() => { preview: LayeredSvgx; elementPos: Vec2 | null })
		| undefined;

	constructor(
		ctx: DragInitContext<T>,
		inner: DragSpecData<T>,
		readonly ghost: SvgxProps | undefined,
		readonly tether: ((dist: number) => number) | undefined,
	) {
		super(ctx, inner);
		assert(
			ctx.draggedId !== null,
			"Floating drags require the dragged element to have an id",
		);
		this.draggedId = ctx.draggedId;
	}

	get outputPreview(): LayeredSvgx | undefined {
		return this.computed?.().preview;
	}

	get elementPos(): Vec2 | null | undefined {
		return this.computed?.().elementPos;
	}

	frame(frame: DragFrame): OpResult<T> {
		const { ctx, draggedId } = this;
		const innerResult = this.inner.run(frame);

		let cached: { preview: LayeredSvgx; elementPos: Vec2 | null } | null = null;
		const computePreview = () => {
			if (cached) return cached;

			const layered = innerResult.preview();
			const draggedLayer = layered.byId.get(draggedId);

			let elementPos: Vec2 | null = null;
			let floatAnchored: LayeredSvgx;
			let backdrop: LayeredSvgx;
			if (!draggedLayer) {
				if (this.cachedFloatAnchored === null) {
					const startLayered = renderDraggableInert(
						ctx.draggable,
						ctx.startState,
						draggedId,
						false,
					);
					const { extracted } = layeredExtract(startLayered, draggedId);
					const startDraggedLayer = startLayered.byId.get(draggedId);
					const floatPos = startDraggedLayer
						? localToGlobal(
								startDraggedLayer.element.props.transform,
								ctx.anchorPos,
							)
						: Vec2(0);
					this.cachedFloatAnchored = layeredTransform(
						extracted,
						translate(floatPos.mul(-1)),
					);
				}
				floatAnchored = this.cachedFloatAnchored;
				backdrop = layered;
			} else {
				elementPos = localToGlobal(
					draggedLayer.element.props.transform,
					ctx.anchorPos,
				);
				const { remaining, extracted } = layeredExtract(layered, draggedId);
				floatAnchored = layeredTransform(
					extracted,
					translate(elementPos.mul(-1)),
				);
				this.cachedFloatAnchored = floatAnchored;

				if (this.ghost !== undefined) {
					backdrop = layeredMerge(
						remaining,
						layeredSetAttributes(
							layeredPrefixIds(extracted, "ghost-"),
							this.ghost,
						),
					);
				} else {
					backdrop = remaining;
				}
			}

			let target = frame.pointer;
			if (elementPos && this.tether) {
				const v = frame.pointer.sub(elementPos);
				const dist = v.len();
				if (dist > 1e-6) {
					const newDist = this.tether(dist);
					target = elementPos.add(v.mul(newDist / dist));
				}
			}

			const floatPositioned = layeredTransform(
				floatAnchored,
				translate(target),
			);
			const preview = layeredMerge(
				backdrop,
				pipe(
					floatPositioned,
					(h) => layeredSetAttributes(h, { dragologyTransition: false }),
					(h) => layeredShiftZIndices(h, 1000000),
				),
			);
			cached = { preview, elementPos };
			return cached;
		};
		this.computed = computePreview;

		return {
			...innerResult,
			preview: () => computePreview().preview,
			dropTransition: undefined,
			activePathTransition: undefined,
			chainNow: undefined,
			grabPos: this.tether ? undefined : frame.pointer,
		};
	}

	treeView(props: OpTreeViewProps) {
		const preview = this.outputPreview;
		return (
			<Box label="withFloating" color={props.color} path={props.path}>
				{preview && <OutputThumbnail outputPreview={preview} />}
				{this.inner.treeView(props)}
			</Box>
		);
	}

	overlayVis({ active, opacity }: OpOverlayVisProps) {
		if (!this.lastFrame) return null;
		const { pointer } = this.lastFrame;
		const elementPos = this.elementPos;
		return (
			<g>
				<OverlayVis op={this.inner.op} active={active} />
				{elementPos && (
					<g opacity={opacity}>
						<circle cx={elementPos.x} cy={elementPos.y} r={5} fill="magenta" />
						<DistanceLine
							from={elementPos}
							to={pointer}
							distance={pointer.dist(elementPos)}
						/>
					</g>
				)}
			</g>
		);
	}
}
