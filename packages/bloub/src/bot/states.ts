import {
	type ArcSpec,
	COMET_DOT,
	COMET_RIBBONS,
	DOT_PEAK,
	DOT_R,
	DOT_X,
	type DotRender,
	NOTIF_ANGLE,
	NOTIF_DIST,
	NOTIF_MARGIN,
	NOTIF_POP,
	NOTIF_R,
	particles,
	RINGS,
	SWOOSH,
} from "./decor";
import { EYE_H, EYE_SPLIT, EYE_W, type HeadGaze, REST_GAZE } from "./face";
import { clamp, easings, TAU } from "./math";
import {
	circle,
	hullOfCircles,
	polyPath,
	profileFromPolygon,
	type Silhouette,
	silhouette,
} from "./shape";

export interface EyeCfg {
	w: number;
	h: number;
	open: number;
	tilt?: number;
}

export interface Pose {
	sil: Silhouette;
	offX: number;
	offY: number;
	gaze: HeadGaze;
	split: number;
	eyes: [EyeCfg, EyeCfg];
	eyeAlpha: number;
	bodyAlpha: number;
	dots: DotRender[];
	arcs: ArcSpec[];
	notif: { x: number; y: number; r: number; notch: number } | null;
	dotsBehind: boolean;
}

const pair = (w: number, h: number): [EyeCfg, EyeCfg] => [
	{ w, h, open: 1 },
	{ w, h, open: 1 },
];

function base(over: Partial<Pose> = {}): Pose {
	return {
		sil: circle(1),
		offX: 0,
		offY: 0,
		gaze: { ...REST_GAZE },
		split: EYE_SPLIT,
		eyes: pair(EYE_W, EYE_H),
		eyeAlpha: 1,
		bodyAlpha: 1,
		dots: [],
		arcs: [],
		notif: null,
		dotsBehind: false,
		...over,
	};
}

const BAR_UPRIGHT_CY = -0.1875;
const BAR_UPRIGHT = profileFromPolygon(
	hullOfCircles(0, -0.505, 0.132, 0, 0.13, 0.075),
	0,
	BAR_UPRIGHT_CY,
);

const BAR_ITALIC = profileFromPolygon(
	hullOfCircles(0, -0.2535, 0.1345, 0, 0.2535, 0.1345),
	0,
	0,
);

const barUpright = (pose: Partial<Silhouette> = {}): Silhouette => ({
	radii: [...BAR_UPRIGHT],
	rot: 0,
	cx: 0,
	cy: BAR_UPRIGHT_CY,
	sx: 1,
	sy: 1,
	...pose,
});

const barItalic = (pose: Partial<Silhouette> = {}): Silhouette => ({
	radii: [...BAR_ITALIC],
	rot: 0,
	cx: 0,
	cy: 0,
	sx: 1,
	sy: 1,
	...pose,
});

const TEAR = polyPath(hullOfCircles(0, 0, 0.118, 0, 0.172, 0.012));

const TRI_ORBIT = 0.213;

function spinningTriangle(rot: number): Silhouette {
	return silhouette("triangle", {
		rot,
		cx: -TRI_ORBIT * Math.sin(rot),
		cy: TRI_ORBIT * Math.cos(rot),
	});
}

export type StateId =
	| "idle"
	| "thinking"
	| "wink"
	| "wide"
	| "alert"
	| "notify"
	| "exclaim"
	| "sleep"
	| "egg"
	| "hexagon"
	| "play"
	| "orbit"
	| "burst"
	| "comet"
	| "swirl";

export interface StateDef {
	id: StateId;
	duration: number;
	minDuration?: number;
	morph: number;
	blinkIn: boolean;
	baseBody: boolean;
	baseFace: boolean;
	pose(local: number): Pose;
}

function dotPulse(t: number, index: number): number {
	const p = ((((t - index * 0.5) / 1.5) % 1) + 1) % 1;
	const k = p < 0.5 ? 0.5 - 0.5 * Math.cos(p * TAU) : 0;
	return clamp(k * 2);
}

export const STATES: StateDef[] = [
	{
		id: "idle",
		duration: 2.4,
		morph: 0.45,
		blinkIn: false,
		baseFace: true,
		baseBody: true,
		pose: () => base(),
	},

	{
		id: "thinking",
		duration: 2.6,
		morph: 0.4,
		baseFace: false,
		baseBody: false,
		blinkIn: true,
		pose: (t) => {
			const mid = dotPulse(t, 1);
			const emerge = 0.3 + 0.7 * easings.easeOutCubic(clamp(t / 0.3));
			return base({
				sil: circle(DOT_R * (1 + (DOT_PEAK - 1) * mid), { cx: DOT_X[1]! }),
				eyeAlpha: 0,
				dots: [0, 2].map((i) => {
					const k = dotPulse(t, i);
					return {
						x: DOT_X[i]! * emerge,
						y: 0,
						r: DOT_R * (1 + (DOT_PEAK - 1) * k),
						opacity: 0.55 + 0.45 * k,
					};
				}),
			});
		},
	},

	{
		id: "wink",
		duration: 1.6,
		morph: 0.3,
		blinkIn: true,
		baseFace: false,
		baseBody: true,
		pose: () =>
			base({
				gaze: { yaw: -5.37, pitch: 4.55, roll: 6.7 },
				split: 16.25,
				eyes: [
					{ w: 0.236, h: 0.464, open: 1 },
					{ w: 0.447, h: 0.089, open: 1 },
				],
			}),
	},

	{
		id: "wide",
		duration: 1.8,
		morph: 0.55,
		blinkIn: true,
		baseFace: false,
		baseBody: true,
		pose: () =>
			base({
				gaze: { yaw: 6.92, pitch: -21.96, roll: 11.6 },
				split: 18.43,
				eyes: pair(0.356, 0.875),
			}),
	},

	{
		id: "alert",
		duration: 2.4,
		minDuration: 2,
		morph: 0.45,
		baseFace: false,
		baseBody: false,
		blinkIn: false,
		pose: (t) => {
			const p = clamp(t / 1.5);
			const travel = easings.easeInOutCubic(p) * 0.82 - 0.087;
			const back = t > 1.6 ? clamp((t - 1.6) / 0.4) : 0;
			const x = travel * (1 - back) + 0.1 * back;
			const buzz = Math.sin(t * 2.5 * TAU) * 0.005;
			const tilt = (17.7 * Math.PI) / 180;
			return base({
				sil: barItalic({ rot: tilt, cx: x, cy: -0.325 - buzz }),
				eyeAlpha: 0,
				dots: [
					{
						x: x - Math.sin(tilt) * 0.58,
						y: -0.325 + Math.cos(tilt) * 0.58 + buzz * 2.8,
						r: 0.118,
						d: TEAR,
						rot: (tilt * 180) / Math.PI,
						opacity: 1,
					},
				],
			});
		},
	},

	{
		id: "notify",
		duration: 2.2,
		morph: 0.5,
		blinkIn: true,
		baseFace: false,
		baseBody: true,
		pose: (t) => {
			const p = clamp(t / 0.45);
			const pop = 1 + (NOTIF_POP - 1) * Math.sin(p * Math.PI) * (1 - p * 0.35);
			const r = NOTIF_R * (p < 1 ? pop : 1);
			const a = (NOTIF_ANGLE * Math.PI) / 180;
			return base({
				gaze: { yaw: -21.94, pitch: -5.82, roll: -12.2 },
				split: 18.89,
				eyes: pair(0.505, 0.498),
				notif: {
					x: Math.cos(a) * NOTIF_DIST,
					y: Math.sin(a) * NOTIF_DIST,
					r,
					notch: r + NOTIF_MARGIN,
				},
			});
		},
	},

	{
		id: "exclaim",
		duration: 2,
		morph: 0.45,
		baseFace: false,
		baseBody: false,
		blinkIn: false,
		pose: () =>
			base({
				sil: barUpright(),
				eyeAlpha: 0,
				dots: [{ x: -0.012, y: 0.526, r: 0.113, opacity: 1 }],
			}),
	},

	{
		id: "sleep",
		duration: 2.4,
		morph: 0.5,
		baseFace: false,
		baseBody: false,
		blinkIn: false,
		pose: (t) =>
			base({
				sil: circle(0.1585, { cy: 0.11 + Math.sin(t * (TAU / 0.6)) * 0.19 }),
				eyeAlpha: 0,
			}),
	},

	{
		id: "egg",
		duration: 1.8,
		morph: 0.4,
		baseFace: false,
		baseBody: false,
		blinkIn: true,
		pose: () =>
			base({
				sil: silhouette("egg"),
				gaze: { yaw: 19.97, pitch: 26.01, roll: -17.1 },
				split: 11.07,
				eyes: pair(0.164, 0.385),
			}),
	},

	{
		id: "hexagon",
		duration: 1.6,
		morph: 0.4,
		baseFace: false,
		baseBody: false,
		blinkIn: true,
		pose: () =>
			base({
				sil: silhouette("hexagon"),
				gaze: { yaw: 23.11, pitch: 24.42, roll: -13.3 },
				split: 13.37,
				eyes: pair(0.177, 0.411),
			}),
	},

	{
		id: "play",
		duration: 2,
		morph: 0.5,
		baseFace: false,
		baseBody: false,
		blinkIn: true,
		pose: (t) => {
			const fade = clamp(t / 0.35) * clamp((2.2 - t) / 0.5);
			return base({
				sil: spinningTriangle(0),
				gaze: { yaw: 12, pitch: -8, roll: -6 },
				split: 15,
				eyes: pair(0.18, 0.34),
				arcs: SWOOSH.map((s, i) => ({
					id: `sw${i}`,
					seed: { ...s, cx: 0.45 - t * 0.42 },
					t,
					opacity: fade,
				})),
			});
		},
	},

	{
		id: "orbit",
		duration: 3.4,
		minDuration: 2.5,
		morph: 0.6,
		baseFace: false,
		baseBody: false,
		blinkIn: false,
		pose: (t) => {
			const ramp = easings.easeInOutCubic(clamp(t / 0.35));
			const rot = -TAU * 1.25 * t * ramp;
			const back = easings.easeInOutCubic(clamp((t - 1.6) / 0.9));
			const tri = spinningTriangle(rot);
			const ball = circle(1, { rot });
			const sil: Silhouette = {
				radii: tri.radii.map((r, i) => r + (ball.radii[i]! - r) * back),
				rot,
				cx: tri.cx * (1 - back),
				cy: tri.cy * (1 - back),
				sx: 1,
				sy: 1,
			};
			const fade = clamp(t / 0.8) * clamp((3.6 - t) / 0.9);
			return base({
				sil,
				gaze: {
					yaw: REST_GAZE.yaw + Math.sin(t * 6.5) * 65 * (1 - back),
					pitch: -4 + back * 32,
					roll: -13,
				},
				eyes: pair(0.18, 0.34 + back * 0.07),
				arcs: RINGS.map((s, i) => ({
					id: `rg${i}`,
					seed: s,
					t,
					opacity: fade * clamp((t - i * 0.13) / 0.3),
				})),
			});
		},
	},

	{
		id: "swirl",
		duration: 1.3,
		minDuration: 1.3,
		morph: 0.3,
		baseFace: true,
		baseBody: true,
		blinkIn: true,
		pose: (t) =>
			base({
				arcs: RINGS.slice(0, 3).map((s, i) => ({
					id: `sw${i}`,
					seed: s,
					t,
					opacity: clamp((t - i * 0.06) / 0.14) * clamp((1.22 - t) / 0.34),
				})),
			}),
	},

	{
		id: "burst",
		duration: 2.6,
		minDuration: 2.4,
		morph: 0.4,
		baseFace: false,
		baseBody: false,
		blinkIn: false,
		pose: (t) => {
			const collapse = 1 - 0.834 * easings.easeOutQuint(clamp(t / 0.7));
			const regrow = easings.easeOutQuint(clamp((t - 1.7) / 0.7));
			return base({
				sil: circle(collapse + (1 - collapse) * regrow),
				eyeAlpha: clamp((t - 1.85) / 0.4),
				dots: particles(t, 1),
				dotsBehind: true,
			});
		},
	},

	{
		id: "comet",
		duration: 2.4,
		minDuration: 2.4,
		morph: 0.45,
		baseFace: false,
		baseBody: false,
		blinkIn: false,
		pose: (t) => {
			const collapse =
				1 - (1 - COMET_DOT) * easings.easeOutQuint(clamp(t / 0.55));
			const regrow = easings.easeOutQuint(clamp((t - 1.85) / 0.6));
			const fade = clamp((t - 0.15) / 0.25) * clamp((1.95 - t) / 0.3);
			return base({
				sil: circle(collapse + (1 - collapse) * regrow, {
					cy: Math.sin(clamp(t / 1.7) * Math.PI) * 0.035,
				}),
				eyeAlpha: clamp((t - 2) / 0.35),
				arcs: COMET_RIBBONS.map((s, i) => ({
					id: `cm${i}`,
					seed: s,
					t,
					opacity: fade,
				})),
			});
		},
	},
];

export const STATE_BY_ID = new Map(STATES.map((s) => [s.id, s]));

export const POSES: Record<StateId, number> = {
	idle: 1,
	thinking: 1.1,
	wink: 0.8,
	wide: 0.8,
	alert: 0.75,
	notify: 0.9,
	exclaim: 0.8,
	sleep: 0.45,
	egg: 0.8,
	hexagon: 0.8,
	play: 0.9,
	orbit: 1.2,
	swirl: 0.5,
	burst: 0.45,
	comet: 1.15,
};

export const SEQUENCE: StateId[] = [
	"idle",
	"thinking",
	"wink",
	"wide",
	"alert",
	"notify",
	"exclaim",
	"sleep",
	"egg",
	"hexagon",
	"play",
	"orbit",
	"burst",
	"comet",
];
