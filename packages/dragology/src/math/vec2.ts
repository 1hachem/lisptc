import { clamp } from "../utils";
import { assertNever } from "../utils/assert";

export type Vec2 = Vec2Class;

export type Vec2able =
	| Vec2
	| { x: number; y: number }
	| ArrayWithTwoNumbers
	| number;

export type Vec2Args = [x: number, y: number] | [xy: Vec2able];

export function Vec2(...args: Vec2Args): Vec2 {
	const [xOrXY, y] = args;
	if (typeof xOrXY === "number") {
		if (y === undefined) {
			return new Vec2Class(xOrXY, xOrXY);
		} else {
			return new Vec2Class(xOrXY, y);
		}
	} else if (isVec2(xOrXY)) {
		return xOrXY;
	} else if (typeof xOrXY === "object" && "x" in xOrXY && "y" in xOrXY) {
		return new Vec2Class(xOrXY.x, xOrXY.y);
	} else if (isArrayWithTwoNumbers(xOrXY)) {
		return new Vec2Class(xOrXY[0], xOrXY[1]);
	} else {
		assertNever(xOrXY);
	}
}

export namespace Vec2 {
	export function polarRad(r: number, angleRad: number): Vec2 {
		return Vec2(r, 0).rotateRad(angleRad);
	}
	export function polarDeg(r: number, angleDeg: number): Vec2 {
		return Vec2(r, 0).rotateDeg(angleDeg);
	}
}

type ArrayWithTwoNumbers =
	| [number, number, ...any]
	| readonly [number, number, ...any];

function isArrayWithTwoNumbers(value: unknown): value is ArrayWithTwoNumbers {
	return (
		Array.isArray(value) &&
		value.length === 2 &&
		typeof value[0] === "number" &&
		typeof value[1] === "number"
	);
}

function isVec2(value: unknown): value is Vec2 {
	return value instanceof Vec2Class;
}

class Vec2Class {
	constructor(
		readonly x: number,
		readonly y: number,
	) {}

	*[Symbol.iterator](): Iterator<number> {
		yield this.x;
		yield this.y;
	}

	arr(): [number, number] {
		return [this.x, this.y];
	}

	str(sep = ","): string {
		return `${this.x}${sep}${this.y}`;
	}

	xy(): { x: number; y: number } {
		return { x: this.x, y: this.y };
	}

	xy1(): { x1: number; y1: number } {
		return { x1: this.x, y1: this.y };
	}

	xy2(): { x2: number; y2: number } {
		return { x2: this.x, y2: this.y };
	}

	cxy(): { cx: number; cy: number } {
		return { cx: this.x, cy: this.y };
	}

	eq(v: Vec2able): boolean {
		v = Vec2(v);
		return this.x === v.x && this.y === v.y;
	}

	add(...vs: Vec2able[]): Vec2 {
		let result: Vec2 = this;
		for (const v of vs) {
			const vec = Vec2(v);
			result = Vec2(result.x + vec.x, result.y + vec.y);
		}
		return result;
	}

	sub(v: Vec2able): Vec2 {
		v = Vec2(v);
		return Vec2(this.x - v.x, this.y - v.y);
	}

	mul(n: number): Vec2 {
		return Vec2(this.x * n, this.y * n);
	}

	div(n: number): Vec2 {
		return Vec2(this.x / n, this.y / n);
	}

	scale(v: Vec2able): Vec2 {
		v = Vec2(v);
		return Vec2(this.x * v.x, this.y * v.y);
	}

	dot(v: Vec2able): number {
		v = Vec2(v);
		return this.x * v.x + this.y * v.y;
	}

	cross(v: Vec2able): number {
		v = Vec2(v);
		return this.x * v.y - this.y * v.x;
	}

	len2(): number {
		return this.dot(this);
	}

	len(): number {
		return Math.hypot(this.x, this.y);
	}

	norm(): Vec2 {
		return this.div(this.len());
	}

	withLen(length: number): Vec2 {
		return this.norm().mul(length);
	}

	angleRad(): number {
		return Math.atan2(this.y, this.x);
	}

	angleDeg(): number {
		return radToDeg(this.angleRad());
	}

	angleToRad(v: Vec2able): number {
		v = Vec2(v);
		return Math.atan2(v.y - this.y, v.x - this.x);
	}

	angleToDeg(v: Vec2able): number {
		return radToDeg(this.angleToRad(v));
	}

	dist2(v: Vec2able): number {
		v = Vec2(v);
		return this.sub(v).len2();
	}

	dist(v: Vec2able): number {
		v = Vec2(v);
		return this.sub(v).len();
	}

	lerp(v: Vec2able, t: number): Vec2 {
		v = Vec2(v);
		return Vec2(lerp(this.x, v.x, t), lerp(this.y, v.y, t));
	}

	mid(v: Vec2able): Vec2 {
		return this.lerp(v, 0.5);
	}

	projOnto(v: Vec2able): Vec2 {
		const v2 = Vec2(v);
		const scalar = this.dot(v2) / v2.len2();
		return v2.mul(scalar);
	}

	towards(v: Vec2able, d: number): Vec2 {
		const v2 = Vec2(v);
		return this.add(v2.sub(this).norm().mul(d));
	}

	perp(): Vec2 {
		return Vec2(-this.y, this.x);
	}

	rotateRad(angleRad: number): Vec2 {
		const cosA = Math.cos(angleRad);
		const sinA = Math.sin(angleRad);
		return Vec2(this.x * cosA - this.y * sinA, this.x * sinA + this.y * cosA);
	}

	rotateDeg(angleDeg: number): Vec2 {
		return this.rotateRad(degToRad(angleDeg));
	}

	round(): Vec2 {
		return Vec2(Math.round(this.x), Math.round(this.y));
	}

	clamp(a: Vec2able, b: Vec2able): Vec2 {
		a = Vec2(a);
		b = Vec2(b);
		return Vec2(clamp(a.x, b.x, this.x), clamp(a.y, b.y, this.y));
	}
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function degToRad(deg: number): number {
	return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
	return (rad * 180) / Math.PI;
}
