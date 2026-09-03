/**
 * Redraws `public/favicon.svg` and `public/favicon.ico` from the bot engine.
 *
 * The tab icon is the avatar of `components/agent-avatar.tsx` at rest, so it is
 * generated from the same engine rather than drawn by hand: the two cannot drift
 * apart when a silhouette or an expression is re-measured upstream. Run it after
 * such a change — `pnpm --filter app favicon` — and commit the result. It is NOT
 * a build step: the icon is a checked-in asset, and neither `vite build` nor a
 * browser should need a rasteriser.
 *
 * The engine is a pure function of time, so sampling it at a fixed date gives a
 * reproducible image with no animation loop to run. The pose is `idle` wearing
 * the `surpris` face, which is what the avatar wears when nothing is happening.
 *
 * Needs ImageMagick (`magick`) on PATH for the .ico, and nothing else.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BotFrame } from "@repo/bloub/bot/engine.ts";
import { createServer } from "vite";

/** The avatar's own shape, face and eye scale — see `agent-avatar.tsx`. */
const SHAPE = "carre";
const FACE = "surpris";
const EYE_SCALE = 1.29;

/**
 * Gruvbox `--fg` and `--bg`, resolved to hex instead of left as CSS variables:
 * a favicon is fetched as a document of its own, so it inherits nothing from the
 * page, and the theme it belongs to is the only one the app ships.
 */
const INK = "#ebdbb2";
const PAPER = "#1d2021";

/**
 * The sizes that go into the .ico. 16 and 32 are what a browser picks for a tab;
 * 48 is what Windows uses for a pinned shortcut. Bigger ones would only pad the
 * file — an .ico is a bundle of complete images, not a mipmap chain.
 */
const SIZES = [16, 32, 48];

/**
 * The bot package ships bundler-style sources — relative imports with no
 * extension — so `node` cannot load them on its own. Rather than teach it to,
 * the script borrows the app's own resolver, which is the one that has to agree
 * with these files anyway.
 */
async function loadEngine() {
	const vite = await createServer({
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
		logLevel: "warn",
	});
	try {
		const [engine, repere, skins, expressions] = await Promise.all([
			vite.ssrLoadModule("@repo/bloub/bot/engine.ts"),
			vite.ssrLoadModule("@repo/bloub/bot/repere.ts"),
			vite.ssrLoadModule("@repo/bloub/bot/skins.ts"),
			vite.ssrLoadModule("@repo/bloub/bot/expressions.ts"),
		]);
		const shape = skins.SHAPE_BY_ID.get(SHAPE);
		const face = expressions.EXPRESSION_BY_ID.get(FACE);
		if (!shape || !face) throw new Error(`no shape ${SHAPE} or face ${FACE}`);
		return new engine.BotEngine(
			repere.RAYON,
			"idle",
			shape.radii,
			face,
		).sample(0) as BotFrame;
	} finally {
		await vite.close();
	}
}

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
 * Half-width of the drawn body. Read off the path rather than derived from the
 * shape's radii: those are unitless, and it is the engine that knows the scale it
 * drew them at. Bezier control points count toward it, so this can overshoot by a
 * unit or two on a curved silhouette — which only ever adds margin.
 */
function extentOf(path: string): number {
	const numbers = path.match(/-?\d+(?:\.\d+)?/g);
	if (!numbers) throw new Error("empty body path");
	return Math.max(...numbers.map((n) => Math.abs(Number(n))));
}

function renderSvg(frame: BotFrame): string {
	/*
	 * The eyes are FILLED in the paper colour, where the component punches them out
	 * of the body with a `<mask>`. Neither reason is about the drawing: a mask needs
	 * a rasteriser that supports one (ImageMagick's built-in renderer does not), and
	 * a hole would let the tab's own background through — light on a light theme —
	 * where the component always has the page behind it.
	 *
	 * It costs nothing at rest: masking only earns its keep when an eye slides to
	 * the edge of the silhouette, and this pose is centred.
	 */
	const eyes = frame.eyes
		.map(
			(eye) =>
				`<path d="${eye.d}" transform="${eye.matrix} scale(${EYE_SCALE})" fill="${PAPER}"/>`,
		)
		.join("");

	const half = extentOf(frame.bodyPath) * (1 + MARGIN);

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-half} ${-half} ${half * 2} ${half * 2}">`,
		`<path d="${frame.bodyPath}" fill="${INK}"/>`,
		eyes,
		"</svg>",
	].join("");
}

const frame = await loadEngine();

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(publicDir, { recursive: true });

const svgPath = join(publicDir, "favicon.svg");
writeFileSync(svgPath, `${renderSvg(frame)}\n`);

/*
 * One render per size rather than one big render downscaled: at 16px an eye is
 * three pixels across, and reducing a 48px raster smears it into the body.
 */
const pngs = SIZES.map((size) => {
	const png = join(publicDir, `favicon-${size}.png`);
	execFileSync("magick", [
		"-background",
		"none",
		"-density",
		String(size * 4),
		svgPath,
		"-resize",
		`${size}x${size}`,
		png,
	]);
	return png;
});

execFileSync("magick", [...pngs, join(publicDir, "favicon.ico")]);
for (const png of pngs) rmSync(png);

console.log(`favicon.svg + favicon.ico (${SIZES.join("/")}px) written`);
