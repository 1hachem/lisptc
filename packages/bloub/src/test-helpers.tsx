import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { BloubBot, type BloubBotHandle, type BloubBotProps } from "./BloubBot";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const PAPIER = "#fffdf7";

export interface Point {
	x: number;
	y: number;
}

export interface Disque extends Point {
	r: number;
}

export interface Oeil extends Point {
	contour: Point[];
	alpha: number;
	forme: string;
	hauteur: number;
	axe: number;
}

export interface Image {
	cadre: number;
	corps: Point[];
	largeur: number;
	hauteur: number;
	yeux: Oeil[];
	trous: Disque[];
	pastilles: Disque[];
	particules: Point[];
	anneaux: { derriere: number; devant: number };
	html: string;
}

const nombres = (s: string) => s.match(/-?\d+\.?\d*(?:e-?\d+)?/g)!.map(Number);

function contourDuCorps(d: string): Point[] {
	const pts: Point[] = [];
	for (const seg of d.slice(1).split("C")) {
		const n = seg.match(/-?\d+\.?\d*/g)?.map(Number) ?? [];
		if (n.length >= 6) pts.push({ x: n[4]!, y: n[5]! });
		else if (n.length === 2) pts.push({ x: n[0]!, y: n[1]! });
	}
	return pts;
}

function lireOeil(el: Element): Oeil {
	const g = nombres(el.getAttribute("d")!);
	const transform = el.getAttribute("transform")!;
	const [a, b, c, d, e, f] = nombres(/matrix\(([^)]+)\)/.exec(transform)![1]!);
	const k = Number(/scale\(([^)]+)\)/.exec(transform)?.[1] ?? 1);
	const hw = Math.abs(g[0]!);
	const r = Math.abs(g[2]!);
	const droit = Math.abs(g[1]!);
	const contour: Point[] = [];
	const N = 32;
	for (let i = 0; i < N; i++) {
		const u = (i / N) * 4;
		let x: number;
		let y: number;
		if (u < 1) {
			const t = Math.PI * (u - 0.5);
			x = Math.cos(t) * r;
			y = -droit + Math.sin(t) * r;
		} else if (u < 2) {
			x = hw;
			y = -droit + (u - 1) * 2 * droit;
		} else if (u < 3) {
			const t = Math.PI * (u - 2 + 0.5);
			x = Math.cos(t) * r;
			y = droit + Math.sin(t) * r;
		} else {
			x = -hw;
			y = droit - (u - 3) * 2 * droit;
		}
		contour.push({
			x: a! * x * k + c! * y * k + e!,
			y: b! * x * k + d! * y * k + f!,
		});
	}
	return {
		x: e!,
		y: f!,
		contour,
		alpha: Number(el.getAttribute("opacity") ?? 1),
		forme: el.getAttribute("d")!,
		hauteur: Math.hypot(c!, d!) * k * 2 * (droit + r),
		axe: (Math.atan2(d!, c!) * 180) / Math.PI - 90,
	};
}

const disque = (el: Element): Disque => ({
	x: Number(el.getAttribute("cx")),
	y: Number(el.getAttribute("cy")),
	r: Number(el.getAttribute("r")),
});

function lire(svg: SVGSVGElement): Image {
	const cadre = -nombres(svg.getAttribute("viewBox")!)[0]!;
	const peau = svg.querySelector(`path[fill="${PAPIER}"]`)!;
	const corps = contourDuCorps(peau.getAttribute("d")!);
	const xs = corps.map((p) => p.x);
	const ys = corps.map((p) => p.y);
	const dehors = (el: Element) => !el.closest("defs");
	const avant = (el: Element) =>
		Boolean(
			el.compareDocumentPosition(peau) & Node.DOCUMENT_POSITION_FOLLOWING,
		);
	const traits = [...svg.querySelectorAll("path[stroke]")].filter((el) =>
		el.getAttribute("d"),
	);
	return {
		cadre,
		corps,
		largeur: Math.max(...xs) - Math.min(...xs),
		hauteur: Math.max(...ys) - Math.min(...ys),
		yeux: [...svg.querySelectorAll('mask path[fill="#000"]')].map(lireOeil),
		trous: [...svg.querySelectorAll("mask circle")].map(disque),
		pastilles: [...svg.querySelectorAll("circle")].filter(dehors).map(disque),
		particules: [
			...[...svg.querySelectorAll("circle")].filter(dehors).map(disque),
			...[...svg.querySelectorAll('path[transform^="translate"]')].map((el) => {
				const [x, y] = nombres(el.getAttribute("transform")!);
				return { x: x!, y: y! };
			}),
		],
		anneaux: {
			derriere: traits.filter(avant).length,
			devant: traits.filter((el) => !avant(el)).length,
		},
		get html() {
			return svg.outerHTML;
		},
	};
}

export function dedans(poly: Point[], p: Point) {
	let on = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i]!;
		const b = poly[j]!;
		if (
			a.y > p.y !== b.y > p.y &&
			p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
		)
			on = !on;
	}
	return on;
}

export function debordement(image: Image) {
	let pire = 0;
	for (const oeil of image.yeux) {
		for (const p of oeil.contour) {
			if (dedans(image.corps, p)) continue;
			pire = Math.max(
				pire,
				Math.min(...image.corps.map((q) => Math.hypot(q.x - p.x, q.y - p.y))),
			);
		}
	}
	return pire;
}

export async function dessiner(props: BloubBotProps = {}) {
	const hote = document.createElement("div");
	document.body.append(hote);
	const root = createRoot(hote);
	const poignee: { current: BloubBotHandle | null } = { current: null };
	let courant: BloubBotProps = { paper: PAPIER, ...props };
	const peindre = async () => {
		await act(async () => {
			root.render(<BloubBot {...courant} ref={poignee} />);
		});
	};
	await peindre();
	const svg = () => hote.querySelector("svg")!;
	const rendre = async (suite: Partial<BloubBotProps>) => {
		courant = { ...courant, ...suite };
		await peindre();
		return lire(svg());
	};
	return {
		svg,
		image: () => lire(svg()),
		rendre,
		a: (t: number) => rendre({ frozenAt: t }),
		parcourir: async (t: number) => {
			await act(async () => {
				poignee.current!.rendAt(t);
			});
			return lire(svg());
		},
		demonter: async () => {
			await act(async () => {
				root.unmount();
			});
			hote.remove();
		},
	};
}

export async function animer(props: BloubBotProps = {}) {
	const file: FrameRequestCallback[] = [];
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
		file.push(cb);
		return file.length;
	});
	vi.stubGlobal("cancelAnimationFrame", () => {});
	const bot = await dessiner(props);
	bot.svg().getBoundingClientRect = () =>
		({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
	let ms = 0;
	return {
		...bot,
		avancer: async (secondes: number) => {
			const fin = ms + secondes * 1000;
			while (ms < fin) {
				ms += 16;
				const prets = file.splice(0);
				await act(async () => {
					for (const cb of prets) cb(ms);
				});
			}
			return lire(bot.svg());
		},
		pointer: (x: number, y: number) => {
			window.dispatchEvent(
				new PointerEvent("pointermove", {
					clientX: x,
					clientY: y,
					pointerType: "mouse",
				}),
			);
		},
	};
}
