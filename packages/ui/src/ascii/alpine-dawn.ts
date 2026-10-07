import type { Frame, Meta } from "./types.ts";

export const meta = {
	name: "alpine dawn",
	category: "scenes",
	note: "snow peaks catching first light above a still, misty mountain lake",
	cols: 200,
	rows: 100,
	cell: 1,
	fps: 15,
	ground: "#090c18",
	palette: [
		"#0e1430",
		"#151d40",
		"#1d2752",
		"#263365",
		"#314179",
		"#3e508c",
		"#4f62a0",
		"#6577b3",
		"#8090c4",
		"#9eaad3",
		"#bec6e2",
		"#4b3e6c",
		"#6a5482",
		"#8c6a92",
		"#b0829c",
		"#cf96a4",
		"#e8a9a8",
		"#f5bcaa",
		"#ffd0b0",
		"#ffe2c2",
		"#fff1e0",
		"#fdfaf6",
		"#ffc887",
		"#f7a965",
		"#f2a08f",
		"#e58a87",
		"#f8b59d",
		"#d97b7e",
		"#7a4c4a",
		"#a5654f",
		"#523a4a",
		"#1b2034",
		"#262c45",
		"#363c59",
		"#0a1418",
		"#0f1f24",
		"#162a2f",
		"#203a3c",
		"#a3a7c6",
		"#c6c3d8",
		"#e0d4dc",
		"#5a4f7e",
		"#7b6c9c",
		"#9a8cb6",
		"#b8a8c8",
		"#d8bccb",
	],
} satisfies Meta;

const W = 200,
	H = 100;
const N = W * H;
const K = 0.62;
const HZ = 56.5;
const CAM = 1.5;
const SHORE_Z = 46;
const SHORE = 62;
const SR = SHORE;
const LR = H - SHORE;
const SUN = [151, 50];
const DOTS = " ·•●";
const COVER = [0, 0.3, 0.6, 1];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
	(v) => v / 16 - 0.47,
);
const MW = 480,
	M0 = 36,
	MR = SHORE + 2 - M0;
const CW = 640,
	CR = 34;
const PINES = [
	[9, 5, 1.15],
	[20, 38, 0.85],
	[32, 66, 0.5],
	[192, 10, 1.15],
	[181, 40, 0.75],
	[204, 26, 1],
];

function hash(x: number, y: number): number {
	let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number, period: number): number {
	const xi = Math.floor(x),
		yi = Math.floor(y);
	const fx = x - xi,
		fy = y - yi;
	const u = fx * fx * (3 - 2 * fx),
		v = fy * fy * (3 - 2 * fy);
	let x0 = xi,
		x1 = xi + 1;
	if (period) {
		x0 = ((xi % period) + period) % period;
		x1 = (x0 + 1) % period;
	}
	const a = hash(x0, yi),
		b = hash(x1, yi),
		c = hash(x0, yi + 1),
		d = hash(x1, yi + 1);
	return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, octaves: number, period: number): number {
	let s = 0,
		n = 0,
		amp = 0.5,
		f = 1;
	for (let i = 0; i < octaves; i++) {
		s += amp * noise(x * f, y * f, period * f);
		n += amp;
		amp *= 0.5;
		f *= 2;
	}
	return s / n;
}

function ridged(x: number, y: number, octaves: number): number {
	let s = 0,
		n = 0,
		amp = 0.5,
		f = 1;
	for (let i = 0; i < octaves; i++) {
		const v = 1 - Math.abs(2 * noise(x * f + i * 17.3, y * f, 0) - 1);
		s += amp * v * v;
		n += amp;
		amp *= 0.5;
		f *= 2.1;
	}
	return s / n;
}

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
	const k = clamp((v - a) / (b - a));
	return k * k * (3 - 2 * k);
};
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const hex = (s: string) =>
	[1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
const rayU = (x: number) => ((x + 0.5 - 100) / 100) * K;
const rayV = (r: number) => ((HZ - (r + 0.5)) / 100) * K;

const LIGHT = (() => {
	const v = [0.9, 0.3, 0.14];
	const n = Math.hypot(...v);
	return v.map((c) => c / n);
})();

const PEAKS = [
	[66, 11, 140, 0.95, 0.3],
	[38, 26, 115, 1.1, -0.15],
	[116, 22, 175, 0.9, 0.2],
	[92, 33, 150, 1.0, 0.1],
	[96, 25, 340, 1.1, 0.4],
	[180, 38, 200, 1.5, -0.1],
	[8, 30, 160, 1.2, 0.25],
].map(([sx, row, z, f, a]) => {
	const h = CAM + ((HZ - row) / 100) * K * z - 1.5;
	return [((sx - 100) / 100) * K * z, z, h, h * f, Math.cos(a), Math.sin(a)];
});

function terrain(x: number, z: number): number {
	let h = 0;
	for (const [px, pz, ph, pr, c, s] of PEAKS) {
		const dx = x - px,
			dz = z - pz;
		const rx = dx * c - dz * s,
			rz = dx * s + dz * c;
		const v = ph * (1 - (Math.abs(rx) + Math.abs(rz)) / pr);
		if (v > h) h = v;
	}
	const hills =
		(1 + 3 * fbm(x * 0.04, z * 0.04, 3, 0)) * smooth(SHORE_Z, SHORE_Z + 15, z);
	if (hills > h) h = hills;
	h +=
		((ridged(x * 0.06, z * 0.06, 3) - 0.45) * 6 +
			(ridged(x * 0.2, z * 0.2, 2) - 0.45) * 1.6) *
		smooth(4, 22, h);
	return h;
}

function march(u: number, v: number, oy: number): number {
	let z = SHORE_Z,
		prev = z;
	for (let i = 0; i < 260 && z < 520; i++) {
		const gap = oy + v * z - terrain(u * z, z);
		if (gap < 0) {
			let a = prev,
				b = z;
			for (let j = 0; j < 7; j++) {
				const m = (a + b) / 2;
				if (oy + v * m - terrain(u * m, m) < 0) b = m;
				else a = m;
			}
			return b;
		}
		prev = z;
		z += Math.max(0.35, gap * 0.45) + z * 0.002;
	}
	return 0;
}

function nearestIn(palette: readonly string[]) {
	const P = palette.map(hex);
	const lut = new Uint8Array(32768).fill(255);
	const closest = (r: number, g: number, b: number): number => {
		let best = 0,
			bd = 1e9;
		for (let i = 0; i < P.length; i++) {
			const dr = P[i][0] - r,
				dg = P[i][1] - g,
				db = P[i][2] - b;
			const d = 0.3 * dr * dr + 0.5 * dg * dg + 0.2 * db * db;
			if (d < bd) {
				bd = d;
				best = i;
			}
		}
		return best;
	};
	return (r: number, g: number, b: number): number => {
		const k =
			(Math.min(31, (r * 31.99) | 0) << 10) |
			(Math.min(31, (g * 31.99) | 0) << 5) |
			Math.min(31, (b * 31.99) | 0);
		if (lut[k] === 255) lut[k] = closest(r, g, b);
		return lut[k];
	};
}

interface Mountains {
	depth: Float32Array;
	alt: Float32Array;
	sun: Float32Array;
	snow: Float32Array;
	up: Float32Array;
	rim: Uint8Array;
}

function shadowed(px: number, py: number, z: number): boolean {
	for (let s = 0.8; s < 160; s += 0.6 + s * 0.04) {
		const qx = px + LIGHT[0] * s,
			qy = py + LIGHT[1] * s + 0.15,
			qz = z + LIGHT[2] * s;
		if (qz < SHORE_Z) return false;
		if (qy < terrain(qx, qz)) return true;
	}
	return false;
}

function bakeMountainCell(m: Mountains, r: number, x: number) {
	const v = rayV(r);
	const u = rayU(x);
	const z = march(u, v, CAM);
	if (!z) return;
	const k = r * W + x;
	const px = u * z,
		py = CAM + v * z;
	const e = 0.35;
	const hx = (terrain(px + e, z) - terrain(px - e, z)) / (2 * e);
	const hz = (terrain(px, z + e) - terrain(px, z - e)) / (2 * e);
	const nl = Math.hypot(hx, 1, hz);
	const nx = -hx / nl,
		ny = 1 / nl,
		nz = -hz / nl;
	const lit = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
	m.depth[k] = z;
	m.alt[k] = py;
	m.sun[k] = lit > 0 && shadowed(px, py, z) ? 0 : lit;
	m.up[k] = ny;
	const grain = fbm(px * 0.4, py * 0.25, 2, 0);
	const gully = ridged(px * 0.22 + z * 0.05, py * 0.045, 2);
	m.snow[k] =
		smooth(0.36, 0.52, ny + 0.3 * (grain - 0.5)) *
		smooth(5, 11, py + 5 * grain) *
		(1 - 0.75 * smooth(0.62, 0.85, gully));
}

function bakeMountains(): Mountains {
	const m: Mountains = {
		depth: new Float32Array(SR * W),
		alt: new Float32Array(SR * W),
		sun: new Float32Array(SR * W),
		snow: new Float32Array(SR * W),
		up: new Float32Array(SR * W),
		rim: new Uint8Array(SR * W),
	};
	for (let r = 0; r < SR; r++) {
		for (let x = 0; x < W; x++) bakeMountainCell(m, r, x);
	}
	for (let k = W; k < SR * W; k++)
		m.rim[k] = m.depth[k] && !m.depth[k - W] && m.sun[k] > 0 ? 1 : 0;
	return m;
}

function bakeTreeline(): Float32Array {
	const treeTop = new Float32Array(W);
	for (let x = 0; x < W; x++)
		treeTop[x] = SHORE - 0.6 - 1.2 * fbm(x * 0.06, 2.3, 2, 0);
	for (let tx = -2; tx < W + 2; tx += 1.6 + hash(tx * 9, 7) * 2.2) {
		const tip = SHORE - 2.6 - hash(tx * 3, 8) * 4 - 1.5 * smooth(60, 0, tx);
		const slope = 1.1 + hash(tx * 5, 9) * 0.5;
		const end = Math.min(W, tx + 6);
		for (let x = Math.max(0, Math.floor(tx - 6)); x < end; x++) {
			treeTop[x] = Math.min(treeTop[x], tip + Math.abs(x + 0.5 - tx) * slope);
		}
	}
	return treeTop;
}

function bakeReflection(treeTop: Float32Array): Float32Array {
	const src = new Float32Array(LR * W);
	for (let r = SHORE; r < H; r++) {
		const v = rayV(r);
		for (let x = 0; x < W; x++) {
			const z = march(rayU(x), -v, -CAM);
			const vs = -v - (z ? (2 * CAM) / z : 0);
			const mirror = 2 * SHORE - 1 - r;
			src[(r - SHORE) * W + x] =
				mirror >= treeTop[x] ? mirror : HZ - (vs * 100) / K - 0.5;
		}
	}
	return src;
}

interface Foreground {
	kind: Uint8Array;
	shade: Float32Array;
	rim: Float32Array;
}

function paintBank(f: Foreground, r: number, x: number) {
	const y = r + 0.5;
	const bankL = 88 + 14 * smooth(0, 52, x) + 2 * fbm(x * 0.2, 1, 2, 0);
	const bankR = 90 + 12 * smooth(W, W - 40, x) + 2 * fbm(x * 0.2, 4, 2, 0);
	if (y <= bankL && y <= bankR) return;
	f.kind[r * W + x] = 1;
	f.shade[r * W + x] = 0.15 * hash(x, r);
}

function paintPine(f: Foreground, r: number, x: number, pine: number[]) {
	const [px, tip, s] = pine;
	const y = r + 0.5;
	const d = y - tip;
	if (d < 0) return;
	const tier = 3.4 * s;
	const fr = d / tier - Math.floor(d / tier);
	const hw =
		(0.4 + d * 0.2) *
		(0.5 + 0.5 * fr) *
		(1 + 0.6 * (hash(r, Math.floor(px) * 7) - 0.5) * smooth(0, 8, d));
	const dx = x + 0.5 - px;
	if (Math.abs(dx) > hw) return;
	const k = r * W + x;
	f.kind[k] = 2;
	const edge = hw - Math.abs(dx) < 1;
	const sunward = px < SUN[0] ? dx > 0 : dx < 0;
	const side = sunward ? 1 : 0.5;
	f.shade[k] = edge ? side : 0.3 * hash(x * 3, r * 5);
	f.rim[k] = edge ? smooth(70, 44, y) * (0.75 + 0.25 * hash(x, r * 7)) : 0;
}

function bakeForeground(): Foreground {
	const f: Foreground = {
		kind: new Uint8Array(N),
		shade: new Float32Array(N),
		rim: new Float32Array(N),
	};
	for (let r = 0; r < H; r++) {
		for (let x = 0; x < W; x++) {
			paintBank(f, r, x);
			for (const pine of PINES) paintPine(f, r, x, pine);
		}
	}
	return f;
}

function bakeMist(): Float32Array {
	const mist = new Float32Array(MW * MR);
	for (let r = 0; r < MR; r++) {
		for (let x = 0; x < MW; x++) {
			const y = r + M0;
			const q = fbm(x * 0.0125, y * 0.1, 2, MW * 0.0125);
			mist[r * MW + x] = fbm(x * 0.025 + q * 1.4, y * 0.22 + q, 4, MW * 0.025);
		}
	}
	return mist;
}

function bakeCloud(): Float32Array {
	const cloud = new Float32Array(CW * CR);
	for (let r = 0; r < CR; r++) {
		for (let x = 0; x < CW; x++) {
			const y = r + 0.5;
			const q = fbm(x * 0.0125, y * 0.12, 2, 8);
			const c = fbm(x * 0.025 + q * 2, y * 0.2 + q * 0.8, 4, 16);
			cloud[r * CW + x] =
				smooth(0.52, 0.7, c - (0.06 * Math.abs(y - 18)) / 10) *
				smooth(5, 13, y) *
				smooth(33, 24, y);
		}
	}
	return cloud;
}

function bakeHaze(): Float32Array {
	const hz = new Float32Array(N);
	for (let k = 0; k < N; k++)
		hz[k] = fbm((k % W) * 0.03, Math.floor(k / W) * 0.06, 3, 0);
	return hz;
}

interface Sky {
	r: Float32Array;
	g: Float32Array;
	b: Float32Array;
	glow: Float32Array;
}

function bakeSky(hz: Float32Array): Sky {
	const sky: Sky = {
		r: new Float32Array(SR * W),
		g: new Float32Array(SR * W),
		b: new Float32Array(SR * W),
		glow: new Float32Array(SR * W),
	};
	for (let r = 0; r < SR; r++) {
		for (let x = 0; x < W; x++) {
			const y = r + 0.5;
			const v = clamp(y / 52);
			const east = smooth(20, 190, x);
			const dx = x + 0.5 - SUN[0],
				dy = (y - SUN[1]) * 2.2;
			const ds = Math.sqrt(dx * dx + dy * dy);
			const low = v ** 1.9;
			const veil = (hz[r * W + x] - 0.5) * 0.1 * (1 - v);
			sky.r[r * W + x] = 0.03 + veil + low * (0.56 + 0.2 * east);
			sky.g[r * W + x] = 0.04 + veil + low * (0.48 + 0.02 * east);
			sky.b[r * W + x] = 0.13 + veil * 1.6 + low * (0.62 - 0.12 * east);
			sky.glow[r * W + x] =
				Math.exp(-ds / 6) * 0.65 +
				Math.exp(-ds / 15) * 0.2 +
				Math.exp(-ds / 50) * 0.1;
		}
	}
	return sky;
}

interface Scene {
	m: Mountains;
	treeTop: Float32Array;
	src: Float32Array;
	fg: Foreground;
	mist: Float32Array;
	cloud: Float32Array;
	hz: Float32Array;
	sky: Sky;
}

interface Layers {
	AR: Float32Array;
	AG: Float32Array;
	AB: Float32Array;
	FR: Float32Array;
	FG: Float32Array;
	FB: Float32Array;
	floor: Float32Array;
	fade: Float32Array;
	wisp: Float32Array;
}

interface Light {
	t: number;
	warm: number;
	line: number;
	drift: number;
	pulse: number;
	lr: number;
	lg: number;
	lb: number;
}

interface Px {
	r: number;
	g: number;
	b: number;
	fl: number;
}

interface Rgb {
	r: number;
	g: number;
	b: number;
}

function lightAt(t: number, wisp: Float32Array): Light {
	const warm = 0.75 - 0.5 * Math.exp(-t / 60);
	const drift = t * 1.1;
	for (let x = 0; x < W; x++) wisp[x] = noise((x + drift * 0.6) * 0.06, 3.7, 0);
	return {
		t,
		warm,
		line: 6 + 4 * Math.exp(-t / 70),
		drift,
		pulse: 1 + 0.06 * Math.sin((t / 8) * Math.PI * 2),
		lr: 1,
		lg: mix(0.6, 0.8, warm),
		lb: mix(0.55, 0.4, warm),
	};
}

function blend(p: Rgb, r: number, g: number, b: number, a: number) {
	p.r = mix(p.r, r, a);
	p.g = mix(p.g, g, a);
	p.b = mix(p.b, b, a);
}

function shadeMountain(
	p: Px,
	s: Scene,
	l: Light,
	k: number,
	gl: number,
	gg: number,
) {
	const { m, sky } = s;
	const z = m.depth[k];
	const sn = m.snow[k];
	const lit = m.sun[k] * smooth(l.line, l.line + 7, m.alt[k]);
	const amb = (0.55 + 0.45 * m.up[k]) * (0.55 + 0.5 * smooth(4, 34, m.alt[k]));
	const sl = smooth(0.08, 0.24, lit);
	const gold = clamp(
		0.6 * smooth(0.25, 0.8, lit) + 0.5 * smooth(14, 36, m.alt[k]),
	);
	const br = 0.78 + 0.3 * lit;
	const sr = mix(0.13 * amb, l.lr * br, sl);
	const sg = mix(0.17 * amb, mix(l.lg - 0.12, l.lg + 0.14, gold) * br, sl);
	const sb = mix(0.36 * amb, mix(l.lb + 0.02, l.lb + 0.12, gold) * br, sl);
	p.r = mix(mix(0.06, 0.4, sl), sr, sn);
	p.g = mix(mix(0.07, 0.2, sl), sg, sn);
	p.b = mix(mix(0.14, 0.2, sl), sb, sn);
	const wood = smooth(9, 4, m.alt[k]) * smooth(110, 75, z);
	blend(p, 0.07, 0.09, 0.18, wood);
	const fog = smooth(16, 3, m.alt[k]) * smooth(70, 150, z) * 0.6;
	const haze = Math.max(fog, clamp(1 - Math.exp(-(z - SHORE_Z) / 260)) * 0.45);
	blend(
		p,
		sky.r[k] + gl,
		sky.g[k] + gl * gg,
		sky.b[k] + gl * (gg - 0.22),
		haze,
	);
	if (m.rim[k] && sl > 0.3) {
		const a = m.rim[k] * sl;
		blend(p, 1, mix(0.89, 0.95, l.warm), mix(0.76, 0.88, l.warm), a);
	}
	p.fl = mix(mix(0.42, 0.3, wood), 0.04, sl);
}

function shadeStar(p: Px, r: number, x: number, y: number, t: number) {
	if (y >= 34 || hash(x, r * 3 + 11) <= 0.985) return;
	const tw =
		0.6 + 0.4 * Math.sin(t * (1.5 + hash(x, r) * 3) + hash(r, x) * 6.28);
	const s = tw * smooth(150, 40, x) * smooth(34, 6, y) * 0.75;
	p.r = Math.max(p.r, s * 0.9);
	p.g = Math.max(p.g, s * 0.92);
	p.b = Math.max(p.b, s);
}

function shadeCloud(
	p: Px,
	cloud: Float32Array,
	l: Light,
	r: number,
	x: number,
) {
	if (r >= CR) return;
	const y = r + 0.5;
	const sx = x + l.t * 0.8,
		ix = Math.floor(sx),
		fx = sx - ix;
	const c0 = cloud[r * CW + (ix % CW)],
		c1 = cloud[r * CW + ((ix + 1) % CW)];
	const c = (c0 + (c1 - c0) * fx) * (0.35 + 0.65 * smooth(40, 150, x));
	if (c <= 0.01) return;
	const g = Math.exp(-Math.hypot(x + 0.5 - SUN[0], (y - SUN[1]) * 1.6) / 55);
	const b = clamp(0.25 + 0.9 * g);
	blend(
		p,
		mix(0.32, 1, b),
		mix(0.24, mix(0.62, 0.74, l.warm), b),
		mix(0.4, 0.5, b),
		c * 0.75,
	);
}

function shadeSunDisc(p: Px, x: number, y: number) {
	const dx = x + 0.5 - SUN[0],
		dy = y - SUN[1];
	const ds = Math.sqrt(dx * dx + dy * dy);
	if (ds >= 4.5) return;
	blend(p, 1, 0.96, 0.86, smooth(4.5, 3.3, ds));
}

function mistTint(tint: Rgb, x: number, warm: number) {
	const e = smooth(20, 170, x) * (0.6 + 0.4 * warm);
	const near = Math.exp(-Math.abs(x + 0.5 - SUN[0]) / 22) * 0.3;
	tint.r = mix(0.48, 0.9, e) + near;
	tint.g = mix(0.46, 0.7, e) + near * 0.75;
	tint.b = mix(0.7, 0.7, e) + near * 0.5;
}

function shadeMist(
	p: Px,
	s: Scene,
	l: Light,
	tint: Rgb,
	r: number,
	x: number,
	wisp: Float32Array,
) {
	if (r < M0) return;
	const y = r + 0.5;
	const m = s.mist[(r - M0) * MW + (Math.floor(x + l.drift) % MW)];
	const edge = 5 * (m - 0.5) + 4 * (wisp[x] - 0.5);
	const band = smooth(M0 + 14, SHORE - 3, y + edge);
	const a = (0.3 + 0.7 * smooth(0.32, 0.64, m)) * band * 0.6;
	blend(p, tint.r, tint.g, tint.b, a);
	if (a > 0.05) p.fl = Math.max(p.fl, 0.2);
}

function shadeTrees(
	p: Px,
	s: Scene,
	l: Light,
	tint: Rgb,
	r: number,
	x: number,
) {
	const y = r + 0.5;
	if (y < s.treeTop[x]) return;
	const shade = 0.4 + 0.6 * hash(x * 7, r * 3);
	p.r = 0.04 + 0.03 * shade;
	p.g = 0.06 + 0.04 * shade;
	p.b = 0.1 + 0.05 * shade;
	p.fl = 0;
	const m =
		s.mist[(r - M0) * MW + (Math.floor(x * 0.7 + l.drift * 1.9 + 211) % MW)];
	const a = smooth(0.45, 0.72, m) * smooth(s.treeTop[x] + 1, SHORE, y) * 0.6;
	blend(p, tint.r, tint.g, tint.b, a);
}

function shadeAbove(
	s: Scene,
	o: Layers,
	l: Light,
	p: Px,
	tint: Rgb,
	r: number,
	x: number,
) {
	const k = r * W + x;
	const gl = s.sky.glow[k] * l.pulse;
	const gg = 0.62 + 0.28 * smooth(0.15, 0.7, gl);
	p.r = s.sky.r[k] + gl;
	p.g = s.sky.g[k] + gl * gg;
	p.b = s.sky.b[k] + gl * (gg - 0.22);
	p.fl = 0.21;
	if (s.m.depth[k]) shadeMountain(p, s, l, k, gl, gg);
	else {
		shadeStar(p, r, x, r + 0.5, l.t);
		shadeCloud(p, s.cloud, l, r, x);
		shadeSunDisc(p, x, r + 0.5);
	}
	mistTint(tint, x, l.warm);
	shadeMist(p, s, l, tint, r, x, o.wisp);
	shadeTrees(p, s, l, tint, r, x);
	o.AR[k] = p.r;
	o.AG[k] = p.g;
	o.AB[k] = p.b;
	o.FR[k] = p.r;
	o.FG[k] = p.g;
	o.FB[k] = p.b;
	o.floor[k] = p.fl;
}

function shadeLake(s: Scene, o: Layers, l: Light, r: number, x: number) {
	const { t } = l;
	const y = r + 0.5;
	const d = (y - SHORE) / LR;
	const k = r * W + x;
	const w1 = noise(x * 0.045 + t * 0.06, y * 0.5 - t * 0.35, 0);
	const w2 = noise(x * 0.12 - t * 0.1, y * 1.1 - t * 0.7, 0);
	const sway = (w1 - 0.5) * (0.4 + 1.4 * d) + (w2 - 0.5) * 0.5;
	const sx = Math.max(0, Math.min(W - 1, Math.round(x + sway)));
	const row = s.src[(r - SHORE) * W + x] + (w2 - 0.5) * 0.6 * d;
	const sk = Math.max(0, Math.min(SR - 1, Math.round(row))) * W + sx;
	const refl = 0.68 - 0.32 * d;
	const w3 = noise(x * 0.03 + t * 0.04, y * 1.9 - t * 0.45, 0);
	const lift = 1 + (w3 - 0.5) * (0.4 + 0.5 * d);
	const ar = o.AR[sk],
		ag = o.AG[sk],
		ab = o.AB[sk];
	const grey = (ar + ag + ab) / 3;
	const deep = (s.hz[k] - 0.5) * 0.1 * d;
	const roadW = 1.5 + (y - SHORE) * 0.45;
	const road = Math.exp(-(((x + 0.5 - SUN[0]) / roadW) ** 2));
	const glint = smooth(0.55, 0.85, w2) * road * (0.5 + 0.5 * l.warm);
	o.FR[k] = 0.02 + deep + mix(grey, ar, 0.75) * refl * lift + glint;
	o.FG[k] = 0.035 + deep + mix(grey, ag, 0.75) * refl * lift + glint * 0.8;
	o.FB[k] = 0.07 + deep * 1.6 + mix(grey, ab, 0.75) * refl * lift + glint * 0.6;
	o.floor[k] = 0.26;
	o.fade[k] = smooth(H + 2, H - 22, y);
	if (r !== SHORE) return;
	o.FR[k] = 0.06;
	o.FG[k] = 0.12;
	o.FB[k] = 0.14;
	o.floor[k] = 0;
}

function shadeForeground(fg: Foreground, o: Layers, k: number) {
	const s = fg.shade[k];
	o.FR[k] = 0.02 + 0.05 * s;
	o.FG[k] = 0.04 + 0.06 * s;
	o.FB[k] = 0.05 + 0.06 * s;
	o.floor[k] = 0;
	o.fade[k] = 1;
	const e = fg.rim[k];
	if (e > 0 && s === 1) {
		o.FR[k] = mix(o.FR[k], 0.62, e);
		o.FG[k] = mix(o.FG[k], 0.4, e);
		o.FB[k] = mix(o.FB[k], 0.38, e);
		o.floor[k] = 0.12 * e;
	} else if (e > 0 && s === 0.5) {
		o.FR[k] = mix(o.FR[k], 0.2, e);
		o.FG[k] = mix(o.FG[k], 0.22, e);
		o.FB[k] = mix(o.FB[k], 0.36, e);
		o.floor[k] = 0.22 * e;
	}
}

function quantize(
	o: Layers,
	out: string[],
	nearest: (r: number, g: number, b: number) => number,
	color: Uint8Array | undefined,
	k: number,
) {
	const r = Math.floor(k / W),
		x = k % W;
	const cr = o.FR[k],
		cg = o.FG[k],
		cbl = o.FB[k],
		fl = o.floor[k];
	const peak = Math.max(cr, cg, cbl, 1e-4);
	const level = clamp(fl + (1 - fl) * peak ** 1.1) * o.fade[k];
	const step = Math.max(
		0,
		Math.min(3, Math.round(level * 3 + BAYER[(r & 3) * 4 + (x & 3)])),
	);
	out[k] = DOTS[step];
	if (!color) return;
	const want = step ? Math.min(1, (level + 0.06) / COVER[step]) : 0;
	const s = ((0.3 + 0.7 * want) * mix(0.5, 1, smooth(0.08, 0.5, peak))) / peak;
	color[k] = nearest(clamp(cr * s), clamp(cg * s), clamp(cbl * s));
}

function bakeScene(): Scene {
	const treeTop = bakeTreeline();
	const hz = bakeHaze();
	return {
		m: bakeMountains(),
		treeTop,
		src: bakeReflection(treeTop),
		fg: bakeForeground(),
		mist: bakeMist(),
		cloud: bakeCloud(),
		hz,
		sky: bakeSky(hz),
	};
}

function layers(): Layers {
	return {
		AR: new Float32Array(SR * W),
		AG: new Float32Array(SR * W),
		AB: new Float32Array(SR * W),
		FR: new Float32Array(N),
		FG: new Float32Array(N),
		FB: new Float32Array(N),
		floor: new Float32Array(N),
		fade: new Float32Array(N).fill(1),
		wisp: new Float32Array(W),
	};
}

export default function alpineDawn(): Frame {
	const nearest = nearestIn(meta.palette);
	const s = bakeScene();
	const o = layers();
	const out: string[] = new Array(N);
	const p: Px = { r: 0, g: 0, b: 0, fl: 0 };
	const tint: Rgb = { r: 0, g: 0, b: 0 };
	return (t, { color } = {}) => {
		const l = lightAt(t, o.wisp);
		for (let k = 0; k < SR * W; k++)
			shadeAbove(s, o, l, p, tint, Math.floor(k / W), k % W);
		for (let k = SHORE * W; k < N; k++)
			shadeLake(s, o, l, Math.floor(k / W), k % W);
		for (let k = 0; k < N; k++) if (s.fg.kind[k]) shadeForeground(s.fg, o, k);
		for (let k = 0; k < N; k++) quantize(o, out, nearest, color, k);
		const lines: string[] = [];
		for (let r = 0; r < H; r++)
			lines.push(out.slice(r * W, (r + 1) * W).join(""));
		return lines.join("\n");
	};
}
