import type { DragFrame, DragInitContext } from "../DragBehavior";
import { type DragSpec, type DragSpecData, operator } from "../DragSpec";
import { Modifier, type OpResult } from "../op";
import type { Svgx } from "../svgx";
import {
	type LayeredSvgx,
	layeredMerge,
	layeredPrefixIds,
	layeredShiftZIndices,
	layerSvg,
} from "../svgx/layers";

const OVERLAY_Z_SHIFT = 2000000;
let overlayCount = 0;

export function withOverlay<T extends object>(
	this: DragSpec<T>,
	overlay: Svgx,
): DragSpec<T> {
	return operator(WithOverlayOp)(this, overlay);
}

class WithOverlayOp<T extends object> extends Modifier<T> {
	readonly name = "withOverlay";
	readonly layer: LayeredSvgx;

	constructor(ctx: DragInitContext<T>, inner: DragSpecData<T>, overlay: Svgx) {
		super(ctx, inner);
		this.layer = layeredShiftZIndices(
			layeredPrefixIds(
				layerSvg(<g>{overlay}</g>),
				`overlay-${overlayCount++}-`,
			),
			OVERLAY_Z_SHIFT,
		);
	}

	frame(frame: DragFrame): OpResult<T> {
		const result = this.inner.run(frame);
		return {
			...result,
			preview: () => layeredMerge(result.preview(), this.layer),
		};
	}
}
