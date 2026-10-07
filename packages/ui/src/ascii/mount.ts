import type { Env, Frame, Meta, Options, Piece } from "./types.ts";

export type MountOptions = Options & { fps?: number };

interface Grid {
	cols: number;
	rows: number;
	cell: number;
	palette?: readonly string[];
	ground?: string;
}

const rgb = (css: string) =>
	css[0] === "#"
		? [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16))
		: (css.match(/[\d.]+/g) || []).map(Number);
const dark = (css: string) => {
	const c = rgb(css);
	return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 128;
};
const font = (px: number) =>
	`${px}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

class Painter {
	private readonly slots = new Map<number, number>();
	private w = 0;
	private h = 0;
	private sw = 0;
	private sh = 0;
	private ink = "";
	width = -1;

	private constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly ctx: CanvasRenderingContext2D,
		private readonly atlas: HTMLCanvasElement,
		private readonly actx: CanvasRenderingContext2D,
		private readonly grid: Grid,
	) {
		canvas.style.display ||= "block";
		canvas.style.width ||= "100%";
		canvas.style.aspectRatio = `${grid.cols} / ${grid.rows * grid.cell}`;
		this.size();
	}

	static on(canvas: HTMLCanvasElement, grid: Grid): Painter | null {
		const ctx = canvas.getContext("2d");
		const atlas = document.createElement("canvas");
		const actx = atlas.getContext("2d");
		return ctx && actx ? new Painter(canvas, ctx, atlas, actx, grid) : null;
	}

	size() {
		const { canvas, atlas, grid } = this;
		this.width = canvas.clientWidth;
		this.w = (this.width * (devicePixelRatio || 1)) / grid.cols;
		this.h = this.w * grid.cell;
		this.sw = Math.ceil(this.w);
		this.sh = Math.ceil(this.h);
		canvas.width = Math.round(this.w * grid.cols);
		canvas.height = Math.round(this.h * grid.rows);
		atlas.width = this.sw * 32;
		atlas.height = this.sh * 32;
		this.slots.clear();
	}

	refreshInk() {
		if (this.grid.palette) return;
		const ink = getComputedStyle(this.canvas).color;
		if (ink === this.ink) return;
		this.ink = ink;
		this.slots.clear();
		this.actx.clearRect(0, 0, this.atlas.width, this.atlas.height);
	}

	private glyph(code: number, i: number) {
		const { actx, atlas, slots, sw, sh, grid } = this;
		const key = code * 256 + i;
		const hit = slots.get(key);
		if (hit !== undefined) return hit;
		if (slots.size === 1024) {
			actx.clearRect(0, 0, atlas.width, atlas.height);
			slots.clear();
		}
		const s = slots.size;
		const x = (s % 32) * sw,
			y = Math.floor(s / 32) * sh;
		actx.font = font(this.w / 0.6);
		actx.textAlign = "center";
		actx.textBaseline = "middle";
		actx.fillStyle = grid.palette
			? grid.palette[i] || grid.palette[0]
			: this.ink;
		actx.fillText(String.fromCharCode(code), x + sw / 2, y + sh / 2);
		slots.set(key, s);
		return s;
	}

	paint(text: string, color: Uint8Array | undefined) {
		const { canvas, atlas, w, h, sw, sh, grid } = this;
		const ctx = this.ctx;
		if (grid.ground) {
			ctx.fillStyle = grid.ground;
			ctx.fillRect(0, 0, canvas.width, canvas.height);
		} else ctx.clearRect(0, 0, canvas.width, canvas.height);
		for (let k = 0, x = 0, y = 0; k < text.length; k++) {
			const c = text.charCodeAt(k);
			if (c === 10) {
				x = 0;
				y++;
				continue;
			}
			if (c !== 32) {
				const s = this.glyph(c, color ? color[y * grid.cols + x] : 0);
				const dx = Math.round(x * w + (w - sw) / 2),
					dy = Math.round(y * h + (h - sh) / 2);
				ctx.drawImage(
					atlas,
					(s % 32) * sw,
					Math.floor(s / 32) * sh,
					sw,
					sh,
					dx,
					dy,
					sw,
					sh,
				);
			}
			x++;
		}
	}
}

function animate(
	el: HTMLElement,
	fps: number,
	step: (dt: number) => void,
): () => void {
	const still = matchMedia("(prefers-reduced-motion: reduce)");
	let raf = 0;
	let last = 0;
	let seen = false;
	const tick = (now: number) => {
		raf = requestAnimationFrame(tick);
		const dt = now - last;
		if (dt < 1000 / fps - 2) return;
		last = now;
		step(dt);
	};
	const run = () => {
		const go = seen && !document.hidden && !still.matches;
		if (go && !raf) {
			last = performance.now();
			raf = requestAnimationFrame(tick);
		} else if (!go && raf) {
			cancelAnimationFrame(raf);
			raf = 0;
		}
	};
	const io = new IntersectionObserver((entries) => {
		seen = entries[entries.length - 1].isIntersecting;
		run();
	});
	io.observe(el);
	document.addEventListener("visibilitychange", run);
	still.addEventListener("change", run);
	return () => {
		io.disconnect();
		cancelAnimationFrame(raf);
		raf = 0;
		document.removeEventListener("visibilitychange", run);
		still.removeEventListener("change", run);
	};
}

function watchWidth(
	canvas: HTMLCanvasElement,
	painter: Painter,
	draw: () => void,
): ResizeObserver {
	const ro = new ResizeObserver(() => {
		if (canvas.clientWidth === painter.width) return;
		painter.size();
		draw();
	});
	ro.observe(canvas);
	return ro;
}

export function mount(
	el: HTMLElement,
	piece: Piece | Piece["default"],
	options: MountOptions = {},
): () => void {
	const make = typeof piece === "function" ? piece : piece.default;
	const meta: Partial<Meta> = typeof piece === "function" ? {} : piece.meta;
	const { fps = meta.fps ?? 30, ...rest }: MountOptions = {
		...meta.options,
		...options,
	};
	const frame: Frame = make(rest);
	const { cols = 80, rows = 24, palette, ground, cell = 2 } = meta;
	const canvas = el instanceof HTMLCanvasElement ? el : null;
	const painter = canvas
		? Painter.on(canvas, { cols, rows, cell, palette, ground })
		: null;
	if (canvas && !painter) return () => {};
	const color = palette && painter ? new Uint8Array(cols * rows) : undefined;
	const env = (): Env => ({
		paper: canvas && ground ? !dark(ground) : dark(getComputedStyle(el).color),
		color,
	});
	let t = 0;
	const draw = () => {
		if (!painter) {
			el.textContent = frame(t, env());
			return;
		}
		painter.refreshInk();
		painter.paint(frame(t, env()), color);
	};
	const ro = canvas && painter ? watchWidth(canvas, painter, draw) : undefined;
	draw();
	const stop = fps
		? animate(el, fps, (dt) => {
				t += Math.min(dt, 100) / 1000;
				draw();
			})
		: () => {};
	return () => {
		stop();
		ro?.disconnect();
	};
}
