import type { Mark, MarkSize } from "@repo/ui-catalog";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePrefersReducedMotion } from "../lib/motion.ts";
import { type Box, calloutPlacement, type Side } from "../lib/tour-layout.ts";
import { pageZoom, useBox } from "./tour-callout.tsx";

export const POINTER_MS = 3500;

export const CLICK_POINTER_MS = 2000;

const CLICK_AT_MS = 1100;

const PRESS_MS = 220;

interface Timing {
	draw: number;
	erase: number;
}

const ARROW_TIMING: Timing = { draw: 650, erase: 450 };

const OVAL_TIMING: Timing = { draw: 1100, erase: 600 };

const ARROW_SIZES: Record<MarkSize, number> = {
	small: 32,
	medium: 44,
	large: 64,
};

const OVAL_GAP: Record<MarkSize, number> = {
	small: 3,
	medium: 6,
	large: 12,
};

const OVAL_MIN_RADIUS = 14;

const SCREEN_MARGIN = 4;

const HEAD = "L38.5 11 L45 16 L38.5 21";

export const ARROWS = [
	"M3 28 C 9 12, 28 16, 45 16",
	"M2 27 C 12 30, 21 22, 17 14 C 13 6, 4 13, 13 18 C 22 23, 33 16, 45 16",
	"M2 19 C 5 9, 11 8, 15 15 S 24 25, 30 18 S 39 15, 45 16",
	"M7 3 C 3 17, 13 26, 25 22 C 33 19, 38 16, 45 16",
	"M4 22 C 16 21, 26 13, 45 16",
].map((shaft) => `${shaft} ${HEAD}`);

const FACING: Record<Side, string> = {
	left: "",
	right: "scaleX(-1)",
	below: "rotate(-90deg)",
	above: "rotate(90deg)",
};

function hashOf(seed: string): number {
	let hash = 0;
	for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
	return hash;
}

export function arrowFor(seed: string): string {
	return ARROWS[Math.abs(hashOf(seed)) % ARROWS.length] as string;
}

function randomFrom(seed: string): () => number {
	let state = hashOf(seed) >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Point = readonly [number, number];

function smoothThrough(points: readonly Point[]): string {
	const at = (i: number) =>
		points[Math.min(points.length - 1, Math.max(0, i))] as Point;
	const fixed = (n: number) => n.toFixed(1);
	const [x0, y0] = at(0);
	let d = `M${fixed(x0)} ${fixed(y0)}`;
	for (let i = 0; i < points.length - 1; i++) {
		const [ax, ay] = at(i - 1);
		const [bx, by] = at(i);
		const [cx, cy] = at(i + 1);
		const [ex, ey] = at(i + 2);
		d += ` C${fixed(bx + (cx - ax) / 6)} ${fixed(by + (cy - ay) / 6)}, ${fixed(cx - (ex - bx) / 6)} ${fixed(cy - (ey - by) / 6)}, ${fixed(cx)} ${fixed(cy)}`;
	}
	return d;
}

const OVAL_LOOPS = 3;

const OVAL_STEPS_PER_LOOP = 36;

const OVAL_MARGIN = 8;

const OVAL_OVERSHOOT = 0.5;

export interface OvalFit {
	rx: number;
	ry: number;
	roundness: number;
}

export function fitOval(
	width: number,
	height: number,
	size: MarkSize,
	limit: { rx: number; ry: number } = {
		rx: Number.POSITIVE_INFINITY,
		ry: Number.POSITIVE_INFINITY,
	},
): OvalFit {
	const gap = OVAL_GAP[size] + Math.min(8, 0.08 * Math.min(width, height));
	const long = Math.max(width, height) / 2 + gap;
	const short = Math.min(width, height) / 2 + gap;
	const roundness = 2 + 2 * Math.min(1, Math.max(0, (long / short - 1) / 3));
	const along =
		long * (1 + (2 ** (1 / roundness) - 1) * Math.sqrt(short / long));
	const across = short / (1 - (long / along) ** roundness) ** (1 / roundness);
	const [rx, ry] = width >= height ? [along, across] : [across, along];
	return {
		rx: Math.min(limit.rx, Math.max(OVAL_MIN_RADIUS, rx)),
		ry: Math.min(limit.ry, Math.max(OVAL_MIN_RADIUS, ry)),
		roundness,
	};
}

function signedPower(value: number, exponent: number): number {
	return Math.sign(value) * Math.abs(value) ** exponent;
}

export function ovalAround(
	{ rx, ry, roundness }: OvalFit,
	seed: string,
): { d: string; width: number; height: number } {
	const next = randomFrom(seed);
	const outer = {
		width: 2 * (rx + OVAL_MARGIN),
		height: 2 * (ry + OVAL_MARGIN),
	};
	const narrow = Math.min(rx, ry);
	const start = -2.4 + next() * 0.9;
	const tilt = ((next() - 0.5) * 0.06 * narrow) / Math.max(rx, ry);
	const wobble = next() * 2 * Math.PI;
	const drift = next() * 2 * Math.PI;
	const steps = OVAL_LOOPS * OVAL_STEPS_PER_LOOP;
	const sweep = OVAL_LOOPS * 2 * Math.PI + OVAL_OVERSHOOT;
	const curve = 2 / roundness;
	const points = Array.from({ length: steps + 1 }, (_, i): Point => {
		const t = i / steps;
		const angle = start + t * sweep;
		const r = 1.025 - 0.04 * t + 0.012 * Math.sin(3 * angle + wobble);
		const x =
			rx * r * signedPower(Math.cos(angle), curve) +
			0.04 * narrow * Math.sin(2 * Math.PI * t * 1.3 + drift);
		const y =
			ry * r * signedPower(Math.sin(angle), curve) +
			0.05 * narrow * Math.cos(2 * Math.PI * t * 1.1 + drift);
		return [
			outer.width / 2 + x * Math.cos(tilt) - y * Math.sin(tilt),
			outer.height / 2 + x * Math.sin(tilt) + y * Math.cos(tilt),
		];
	});
	return { d: smoothThrough(points), ...outer };
}

const DRAWN =
	'svg, img, video, canvas, input, textarea, select, [contenteditable="true"]';

const MAX_MEASURED_NODES = 200;

function painted(element: Element): boolean {
	const style = getComputedStyle(element);
	const background = style.backgroundColor;
	const filled =
		background !== "" &&
		background !== "transparent" &&
		!/rgba\([^)]*,\s*0\)$/.test(background);
	const bordered = ["Top", "Right", "Bottom", "Left"].some(
		(side) =>
			Number.parseFloat(
				style.getPropertyValue(`border-${side.toLowerCase()}-width`),
			) > 0 &&
			style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none",
	);
	return filled || bordered;
}

function joined(box: DOMRect | undefined, rect: DOMRect): DOMRect | undefined {
	if (rect.width === 0 && rect.height === 0) return box;
	if (box === undefined) return rect;
	const left = Math.min(box.left, rect.left);
	const top = Math.min(box.top, rect.top);
	return new DOMRect(
		left,
		top,
		Math.max(box.right, rect.right) - left,
		Math.max(box.bottom, rect.bottom) - top,
	);
}

function contentRect(element: Element): DOMRect | undefined {
	let box: DOMRect | undefined;
	const walker = document.createTreeWalker(
		element,
		NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
	);
	let seen = 0;
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		if (++seen > MAX_MEASURED_NODES) return undefined;
		if (node.nodeType === Node.TEXT_NODE) {
			if (!node.textContent?.trim()) continue;
			const range = document.createRange();
			range.selectNodeContents(node);
			for (const rect of range.getClientRects()) box = joined(box, rect);
		} else if (
			node instanceof Element &&
			(node.matches(DRAWN) || painted(node))
		)
			box = joined(box, node.getBoundingClientRect());
	}
	return box;
}

export function visibleBox(element: Element): Box | undefined {
	const outer = element.getBoundingClientRect();
	if (outer.width === 0 && outer.height === 0) return undefined;
	const inner = painted(element) ? undefined : contentRect(element);
	const left = Math.max(outer.left, inner?.left ?? outer.left);
	const top = Math.max(outer.top, inner?.top ?? outer.top);
	const right = Math.min(outer.right, inner?.right ?? outer.right);
	const bottom = Math.min(outer.bottom, inner?.bottom ?? outer.bottom);
	const zoom = pageZoom();
	return right > left && bottom > top
		? {
				top: top / zoom,
				left: left / zoom,
				width: (right - left) / zoom,
				height: (bottom - top) / zoom,
			}
		: {
				top: outer.top / zoom,
				left: outer.left / zoom,
				width: outer.width / zoom,
				height: outer.height / zoom,
			};
}

function play(
	element: Element | null,
	keyframes: Keyframe[],
	options: KeyframeAnimationOptions,
): Animation | undefined {
	if (typeof element?.animate !== "function") return undefined;
	const animation = element.animate(keyframes, options);
	animation.finished.catch(() => {});
	return animation;
}

const SWEEP_IN = "cubic-bezier(0.33, 1, 0.68, 1)";

const SWEEP_OUT = "cubic-bezier(0.32, 0, 0.67, 0)";

function sweeps(stroke: SVGPathElement | null, timing: Timing, lasts: number) {
	return [
		play(stroke, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
			duration: timing.draw,
			easing: SWEEP_IN,
			fill: "backwards",
		}),
		play(stroke, [{ strokeDashoffset: 0 }, { strokeDashoffset: 1 }], {
			duration: timing.erase,
			delay: lasts - timing.erase,
			easing: SWEEP_OUT,
			fill: "forwards",
		}),
	];
}

function fades(svg: SVGSVGElement | null, timing: Timing, lasts: number) {
	return [
		play(svg, [{ opacity: 0 }, { opacity: 1 }], {
			duration: 150,
			easing: "ease-out",
			fill: "backwards",
		}),
		play(svg, [{ opacity: 1 }, { opacity: 0 }], {
			duration: timing.erase,
			delay: lasts - timing.erase,
			easing: "ease-in",
			fill: "forwards",
		}),
	];
}

function pressAt(element: Element | null, push: string) {
	return play(
		element,
		[
			{ transform: "translateX(0) scale(1)" },
			{ transform: `translateX(${push}) scale(0.92)`, offset: 0.4 },
			{ transform: "translateX(0) scale(1)" },
		],
		{ duration: PRESS_MS, delay: CLICK_AT_MS, easing: "ease-out" },
	);
}

function idling(
	element: Element | null,
	push: string,
	from: number,
	click: boolean,
) {
	const period = 1200;
	return play(
		element,
		[
			{ transform: "translateX(0)" },
			{ transform: `translateX(${push})` },
			{ transform: "translateX(0)" },
		],
		{
			duration: period,
			delay: from,
			easing: "ease-in-out",
			iterations: click
				? Math.max(0, Math.floor((CLICK_AT_MS - from) / period))
				: Number.POSITIVE_INFINITY,
		},
	);
}

function useScribble(
	still: boolean,
	timing: Timing,
	lasts = POINTER_MS,
	click = false,
) {
	const svg = useRef<SVGSVGElement>(null);
	const nudge = useRef<SVGGElement>(null);
	const stroke = useRef<SVGPathElement>(null);
	useEffect(() => {
		const running = still
			? fades(svg.current, timing, lasts)
			: [
					...sweeps(stroke.current, timing, lasts),
					idling(nudge.current, "2.5px", timing.draw, click),
					...(click ? [pressAt(nudge.current, "4px")] : []),
				];
		return () => {
			for (const animation of running) animation?.cancel();
		};
	}, [still, timing, lasts, click]);
	return { svg, nudge, stroke };
}

const STROKE = {
	fill: "none",
	stroke: "var(--primary)",
	strokeWidth: 1.5,
	strokeLinecap: "round",
	strokeLinejoin: "round",
} as const;

function ScribbleArrow({
	side,
	path,
	size,
	click,
	lasts,
}: {
	side: Side;
	path: string;
	size: number;
	click: boolean;
	lasts: number;
}) {
	const still = usePrefersReducedMotion();
	const { svg, nudge, stroke } = useScribble(still, ARROW_TIMING, lasts, click);
	return (
		<svg
			ref={svg}
			role="img"
			aria-label="look here"
			width={size}
			height={(size * 32) / 48}
			viewBox="0 0 48 32"
			{...STROKE}
			className="absolute top-1/2 left-1/2 overflow-visible"
			style={{ transform: `translate(-50%, -50%) ${FACING[side]}` }}
		>
			<g ref={nudge}>
				<path
					ref={stroke}
					d={path}
					pathLength={1}
					strokeDasharray={1}
					strokeDashoffset={0}
				/>
			</g>
		</svg>
	);
}

const BURST_SIZE = 40;

const BURST =
	"M20 11 L20 5 M27.5 14 L31.5 10 M29 20 L35 20 M27.5 26 L31.5 30 M20 29 L20 35 M12.5 26 L8.5 30 M11 20 L5 20 M12.5 14 L8.5 10";

function ClickBurst({ box }: { box: Box }) {
	const still = usePrefersReducedMotion();
	const stroke = useRef<SVGPathElement>(null);
	useEffect(() => {
		const at = CLICK_AT_MS + PRESS_MS / 2;
		const running = still
			? [
					play(stroke.current, [{ opacity: 1 }, { opacity: 0 }], {
						duration: 400,
						delay: at,
						fill: "both",
					}),
				]
			: [
					play(
						stroke.current,
						[
							{ strokeDashoffset: 1, opacity: 1, scale: "0.7" },
							{ strokeDashoffset: 0, opacity: 1, scale: "1", offset: 0.45 },
							{ strokeDashoffset: 0, opacity: 0, scale: "1.15" },
						],
						{ duration: 550, delay: at, easing: "ease-out", fill: "both" },
					),
				];
		return () => {
			for (const animation of running) animation?.cancel();
		};
	}, [still]);
	return (
		<svg
			data-click-burst
			role="img"
			aria-label="clicked here"
			width={BURST_SIZE}
			height={BURST_SIZE}
			viewBox={`0 0 ${BURST_SIZE} ${BURST_SIZE}`}
			{...STROKE}
			className="pointer-events-none fixed z-[100] overflow-visible"
			style={{
				left: box.left + box.width / 2 - BURST_SIZE / 2,
				top: box.top + box.height / 2 - BURST_SIZE / 2,
			}}
		>
			<path
				ref={stroke}
				d={BURST}
				pathLength={1}
				strokeDasharray={1}
				strokeDashoffset={1}
				opacity={0}
				style={{ transformBox: "fill-box", transformOrigin: "center" }}
			/>
		</svg>
	);
}

function ScribbleOval({ width, height, d }: ReturnType<typeof ovalAround>) {
	const still = usePrefersReducedMotion();
	const { svg, stroke } = useScribble(still, OVAL_TIMING);
	return (
		<svg
			ref={svg}
			role="img"
			aria-label="look here"
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			{...STROKE}
			className="overflow-visible"
		>
			<path
				ref={stroke}
				d={d}
				pathLength={1}
				strokeDasharray={1}
				strokeDashoffset={0}
			/>
		</svg>
	);
}

function arrowBeside(
	box: Box,
	seed: string,
	size: MarkSize,
	click: boolean,
	lasts: number,
) {
	const side = ARROW_SIZES[size];
	const zoom = pageZoom();
	const placement = calloutPlacement(
		box,
		{ width: side, height: side },
		{ width: window.innerWidth / zoom, height: window.innerHeight / zoom },
	);
	return {
		side: placement.side,
		style: {
			top: placement.top,
			left: placement.left,
			width: side,
			height: side,
		},
		drawn: (
			<ScribbleArrow
				side={placement.side}
				path={arrowFor(seed)}
				size={side}
				click={click}
				lasts={lasts}
			/>
		),
	};
}

function ovalRound(box: Box, seed: string, size: MarkSize) {
	const zoom = pageZoom();
	const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
	const room = {
		rx: Math.max(
			OVAL_MIN_RADIUS,
			Math.min(centre.x, window.innerWidth / zoom - centre.x) - SCREEN_MARGIN,
		),
		ry: Math.max(
			OVAL_MIN_RADIUS,
			Math.min(centre.y, window.innerHeight / zoom - centre.y) - SCREEN_MARGIN,
		),
	};
	const oval = ovalAround(fitOval(box.width, box.height, size, room), seed);
	return {
		side: "round",
		style: {
			top: box.top + box.height / 2 - oval.height / 2,
			left: box.left + box.width / 2 - oval.width / 2,
		},
		drawn: <ScribbleOval {...oval} />,
	};
}

export function TourPointer({
	element,
	mark,
	size,
	seed,
	click = false,
	onDone,
}: {
	element: HTMLElement | undefined;
	mark: Mark;
	size: MarkSize;
	seed: string;
	click?: boolean;
	onDone: () => void;
}) {
	const box = useBox(element, visibleBox);
	const clicks = click && mark !== "oval";
	const lasts = clicks ? CLICK_POINTER_MS : POINTER_MS;
	useEffect(() => {
		const timer = setTimeout(onDone, lasts);
		return () => clearTimeout(timer);
	}, [onDone, lasts]);
	if (box === undefined) return null;
	const { side, style, drawn } =
		mark === "oval"
			? ovalRound(box, seed, size)
			: arrowBeside(box, seed, size, clicks, lasts);
	return createPortal(
		<>
			<div
				data-testid="tour-pointer"
				data-mark={mark}
				data-size={size}
				data-click={clicks || undefined}
				data-side={side}
				className="pointer-events-none fixed z-[100]"
				style={style}
			>
				{drawn}
			</div>
			{clicks && <ClickBurst box={box} />}
		</>,
		document.body,
	);
}
