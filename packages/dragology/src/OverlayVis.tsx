import { useContext } from "react";
import type { Vec2 } from "./math/vec2";
import type { Operator } from "./op";
import { StudioHackContext } from "./studio/StudioHackContext";

export function OverlayVis<T extends object>({
	op,
	active = true,
}: {
	op: Operator<T>;
	active?: boolean;
}) {
	const { overlayFullOpacity } = useContext(StudioHackContext);
	const opacity = overlayFullOpacity ? 1 : active ? 0.8 : 0.2;
	return op.overlayVis({ active, opacity });
}

export function DistanceLine({
	from,
	to,
	distance,
}: {
	from: Vec2;
	to: Vec2;
	distance: number;
}) {
	const { overlayHideDistances } = useContext(StudioHackContext);
	const [label, fontSize] =
		distance === Infinity ? ["∞", 24] : [`${Math.round(distance)}px`, 11];
	return (
		<g>
			<line
				{...from.xy1()}
				{...to.xy2()}
				stroke="white"
				strokeWidth={5}
				strokeLinecap="round"
			/>
			<line
				{...from.xy1()}
				{...to.xy2()}
				stroke="magenta"
				strokeWidth={1.5}
				strokeDasharray="4 3"
			/>
			{!overlayHideDistances && (
				<text
					{...from.lerp(to, 0.5).xy()}
					fill="magenta"
					stroke="white"
					strokeWidth={3}
					paintOrder="stroke"
					fontSize={fontSize}
					fontFamily="monospace"
					textAnchor="middle"
					dominantBaseline="central"
				>
					{label}
				</text>
			)}
		</g>
	);
}
