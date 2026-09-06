
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BotFrame } from "@repo/bloub/bot/engine";
import { createServer } from "vite";
import { ICON_FACE, ICON_SHAPE, iconSvg } from "../src/lib/bot-icon.ts";

const SIZES = [16, 32, 48];

async function loadEngine() {
	const vite = await createServer({
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
		logLevel: "warn",
	});
	try {
		const [engine, repere, skins, expressions] = await Promise.all([
			vite.ssrLoadModule("@repo/bloub/bot/engine"),
			vite.ssrLoadModule("@repo/bloub/bot/repere"),
			vite.ssrLoadModule("@repo/bloub/bot/skins"),
			vite.ssrLoadModule("@repo/bloub/bot/expressions"),
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
