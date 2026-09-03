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
 * What the icon looks like is not decided here but in `src/lib/bot-icon.ts`,
 * which `components/animated-favicon.tsx` draws the live icon from as well — so
 * the animation begins on exactly the image these files hold.
 *
 * The engine is a pure function of time, so sampling it at a fixed date gives a
 * reproducible image with no animation loop to run. The pose is `idle` wearing
 * the resting face, which is what the avatar wears when nothing is happening.
 *
 * Needs ImageMagick (`magick`) on PATH for the .ico, and nothing else.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BotFrame } from "@repo/bloub/bot/engine.ts";
import { createServer } from "vite";
import { ICON_FACE, ICON_SHAPE, iconSvg } from "../src/lib/bot-icon.ts";

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
		const shape = skins.SHAPE_BY_ID.get(ICON_SHAPE);
		const face = expressions.EXPRESSION_BY_ID.get(ICON_FACE);
		if (!shape || !face) throw new Error(`no shape ${ICON_SHAPE} or face ${ICON_FACE}`);
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

const frame = await loadEngine();

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(publicDir, { recursive: true });

const svgPath = join(publicDir, "favicon.svg");
writeFileSync(svgPath, `${iconSvg(frame)}\n`);

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
