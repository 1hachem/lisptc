import type { Look } from "./bot/engine";
import type { ExpressionId } from "./bot/expressions";
import { clamp, easings } from "./bot/math";

export const YAW_MAX = 16;
export const PITCH_MAX = 13;

export const PITCH = 10;

export const TURN = 26;

export const SPIN = 360;

export const TURN_TIME = 1.1;

export const HUMEURS: readonly ExpressionId[] = [
	"surpris",
	"heureux",
	"hilare",
	"excite",
	"fier",
	"blase",
];

export type GazeScript = (t: number) => Look;

export const TOUR_TIME = 1.5;

export const tourLook: GazeScript = (t) => ({
	yaw: 0,
	pitch: 0,
	mix: 0,
	spin: SPIN * (1 - easings.easeInOutCubic(clamp(t / TOUR_TIME))),
	wander: 1,
});

export interface Aim {
	nx: number;
	ny: number;
	tour: number;
	pointer: boolean;
}

export function lookTarget({ nx, ny, tour, pointer }: Aim): Look {
	return {
		yaw: -TURN + nx * YAW_MAX,
		pitch: PITCH - ny * PITCH_MAX,
		mix: tour,
		spin: SPIN * (1 - tour),
		wander: pointer ? 0 : 1,
	};
}
