/**
 * What the tab icon IS: the pose, the palette, the frame, and the two ways it
 * gets drawn.
 *
 * Two consumers that must not drift apart. `scripts/favicon.ts` writes the
 * checked-in `.svg`/`.ico` through `iconSvg`; `components/animated-favicon.tsx`
 * draws the live one, frame by frame, through `drawIcon`. Same pose, same
 * colours, same frame, so the animation starts on exactly the image the static
 * file shows.
 *
 * Both take a `BotFrame` and this module never touches the engine itself — only
 * its types. That is what lets the script load this file under plain `node`,
 * where a value import from the bot package would not resolve (its sources are
 * bundler-style; see the script).
 */

import type { BotFrame } from "@repo/bloub/bot/engine.ts";

/** The avatar's own shape, face and eye scale — see `components/agent-avatar.tsx`. */
export const ICON_SHAPE = "carre";
export const ICON_FACE = "surpris";
const ICON_EYE_SCALE = 1.29;

/**
 * Gruvbox `--fg` and `--bg`, resolved to hex instead of left as CSS variables: a
 * favicon is a document of its own, so it inherits nothing from the page, and
 * the theme it belongs to is the only one the app ships.
 */
const ICON_INK = "#ebdbb2";
const ICON_PAPER = "#1d2021";

/**
 * How much of the icon is left empty around the body, as a fraction of its own
 * half-width. The engine's viewBox is wide enough for the orbit and burst states
 * to fly around the body, so the resting silhouette fills 57% of it and the rest
 * is spent on nothing here: at 16px the whole glyph would come out 9 pixels
 * across. Hence the tighter frame, which the component cannot take — it has to
 * hold every state.
 */
const MARGIN = 0.06;

/**
 * Half-width of the square the icon is drawn in, in viewBox units.
 *
 * Measured off the body path rather than derived from the shape's radii: those
 * are unitless, and it is the engine that knows the scale it drew them at.
 * Bezier control points count toward it, so on a curved silhouette this can
 * overshoot by a unit or two — which only ever adds margin.
 *
 * Measure it ONCE, on the resting frame, and hold it. The live icon changes
 * state, and `thinking` shrinks the body to a 22-unit dot with its two other
 * dots outside it: re-measuring per frame zoomed into that dot and cropped the
 * other two off. Resting is also the widest the drawing ever gets — 92 units
 * against `thinking`'s 77 and `exclaim`'s 65 — so a crop taken there clips
 * nothing, and it is the crop the static file already has.
 */
export function iconHalf(frame: BotFrame): number {
	const numbers = frame.bodyPath.match(/-?\d+(?:\.\d+)?/g);
	if (!numbers) throw new Error("empty body path");
	return Math.max(...numbers.map((n) => Math.abs(Number(n)))) * (1 + MARGIN);
}

/**
 * The static file's markup.
 *
 * The eyes are FILLED in the paper colour, where the component punches them out
 * of the body with a `<mask>`. Neither reason is about the drawing: a mask needs
 * a rasteriser that supports one (ImageMagick's built-in renderer does not), and
 * a hole would let the tab's own background through — light on a light theme —
 * where the component always has the page behind it.
 *
 * It costs nothing at rest: masking only earns its keep when an eye slides to
 * the edge of the silhouette, and this pose is centred.
 */
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

/** The engine writes eye placement as an SVG `matrix(a,b,c,d,e,f)`. */
function matrixOf(transform: string): [number, number, number, number, number, number] {
	const n = transform.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)?.map(Number);
	if (n?.length !== 6) throw new Error(`not an SVG matrix: ${transform}`);
	return n as [number, number, number, number, number, number];
}

/**
 * The same drawing on a canvas, for the live icon.
 *
 * `size` is in device pixels, `radius` is the engine's own `scale` — the unit its
 * decor is expressed in, which this module has no other way to know — and `half`
 * is the crop from `iconHalf`, measured once by the caller (see there).
 *
 * A dot's `depth` is ignored: it fogs particles into the page background, and
 * only the burst states have any. None of the moods the tab icon wears is one of
 * them, and there is no page to fog into.
 */
export function drawIcon(
	ctx: CanvasRenderingContext2D,
	frame: BotFrame,
	{ size, radius, half }: { size: number; radius: number; half: number },
): void {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, size, size);

	const k = size / (half * 2);
	ctx.setTransform(k, 0, 0, k, size / 2, size / 2);

	// The dots are the whole animation of `thinking`, and the point of the "!".
	// Behind the body or in front of it, as the frame asks: a burst throws them
	// through the sphere, and the ones on the far side pass under it.
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
