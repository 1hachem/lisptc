import { Vec2, type Vec2Args, type Vec2able } from "../math/vec2";

export function translate(...args: Vec2Args): string {
	const { x, y } = Vec2(...args);
	return `translate(${x},${y}) `;
}

export function rotateDeg(degrees: number, c: Vec2able = Vec2(0)): string {
	const { x, y } = Vec2(c);
	return `rotate(${degrees},${x},${y}) `;
}

export function rotateRad(radians: number, c: Vec2able = Vec2(0)): string {
	return rotateDeg((radians * 180) / Math.PI, c);
}

export function scale(sx: number, sy?: number): string {
	if (sy === undefined) sy = sx;
	return `scale(${sx},${sy}) `;
}

export function path(...pts: (Vec2able | string | number)[]): string {
	return pts
		.map((pt) =>
			typeof pt === "string"
				? pt
				: typeof pt === "number"
					? pt.toString()
					: Vec2(pt).str(),
		)
		.join(" ");
}

export function draggableLine(a: Vec2able, b: Vec2able) {
	const start = Vec2(a);
	const v = Vec2(b).sub(start);
	return {
		transform: translate(start) + rotateDeg(v.angleDeg()) + scale(v.len()),
		x1: 0,
		y1: 0,
		x2: 1,
		y2: 0,
		vectorEffect: "non-scaling-stroke",
	} as const;
}
