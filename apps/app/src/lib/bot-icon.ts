import type { BotFrame } from "@repo/bloub/bot/engine";

export const ICON_SHAPE = "carre";
export const ICON_FACE = "surpris";
const ICON_EYE_SCALE = 1.29;

const ICON_INK = "#ebdbb2";
const ICON_PAPER = "#1d2021";

const MARGIN = 0.06;

export function iconHalf(frame: BotFrame): number {
	const numbers = frame.bodyPath.match(/-?\d+(?:\.\d+)?/g);
	if (!numbers) throw new Error("empty body path");
	return Math.max(...numbers.map((n) => Math.abs(Number(n)))) * (1 + MARGIN);
}

export function iconSvg(frame: BotFrame): string {
	const half = iconHalf(frame);
	const eyes = frame.eyes
		.map(
			(eye) =>
				`<path d="${eye.d}" transform="${eye.matrix} scale(${ICON_EYE_SCALE})" fill="${ICON_PAPER}"/>`,
		)
		.join("");

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-half} ${-half} ${half * 2} ${half * 2}">`,
		`<path d="${frame.bodyPath}" fill="${ICON_INK}"/>`,
		eyes,
		"</svg>",
	].join("");
}

function matrixOf(
	transform: string,
): [number, number, number, number, number, number] {
	const n = transform.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)?.map(Number);
	if (n?.length !== 6) throw new Error(`not an SVG matrix: ${transform}`);
	return n as [number, number, number, number, number, number];
}

export function drawIcon(
	ctx: CanvasRenderingContext2D,
	frame: BotFrame,
	{ size, radius, half }: { size: number; radius: number; half: number },
): void {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, size, size);

	const k = size / (half * 2);
	ctx.setTransform(k, 0, 0, k, size / 2, size / 2);

	const paintDots = () => {
		for (const dot of frame.dots) {
			ctx.save();
			ctx.globalAlpha = dot.opacity;
			ctx.fillStyle = dot.color ?? ICON_INK;
			if (dot.d) {
				ctx.translate(dot.x, dot.y);
				ctx.rotate(((dot.rot ?? 0) * Math.PI) / 180);
				ctx.scale(radius, radius);
				ctx.fill(new Path2D(dot.d));
			} else {
				ctx.beginPath();
				ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.restore();
		}
	};

	if (frame.dotsBehind) paintDots();

	ctx.globalAlpha = frame.bodyAlpha;
	ctx.fillStyle = ICON_INK;
	ctx.fill(new Path2D(frame.bodyPath));

	ctx.fillStyle = ICON_PAPER;
	for (const eye of frame.eyes) {
		ctx.save();
		ctx.transform(...matrixOf(eye.matrix));
		ctx.scale(ICON_EYE_SCALE, ICON_EYE_SCALE);
		ctx.globalAlpha = frame.bodyAlpha * eye.alpha;
		ctx.fill(new Path2D(eye.d));
		ctx.restore();
	}

	if (!frame.dotsBehind) paintDots();

	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalAlpha = 1;
}
