import React from "react";
import { Vec2 } from "../math/vec2";
import { type Svgx, shouldRecurseIntoChildren } from ".";
import { localToGlobal, parseTransform } from "./transform";

export type Bounds =
	| { empty: true }
	| { empty: false; minX: number; minY: number; maxX: number; maxY: number };

export const emptyBounds: Bounds = { empty: true };

export function pointInBounds(point: Vec2, bounds: Bounds): boolean {
	if (bounds.empty) return false;
	return (
		point.x >= bounds.minX &&
		point.x <= bounds.maxX &&
		point.y >= bounds.minY &&
		point.y <= bounds.maxY
	);
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
	if (a.empty) return b;
	if (b.empty) return a;
	return {
		empty: false,
		minX: Math.min(a.minX, b.minX),
		minY: Math.min(a.minY, b.minY),
		maxX: Math.max(a.maxX, b.maxX),
		maxY: Math.max(a.maxY, b.maxY),
	};
}

function transformBounds(bounds: Bounds, transformStr: string): Bounds {
	if (bounds.empty) return bounds;
	const transforms = parseTransform(transformStr);
	if (transforms.length === 0) return bounds;

	const corners = [
		Vec2(bounds.minX, bounds.minY),
		Vec2(bounds.maxX, bounds.minY),
		Vec2(bounds.maxX, bounds.maxY),
		Vec2(bounds.minX, bounds.maxY),
	].map((c) => localToGlobal(transforms, c));

	return {
		empty: false,
		minX: Math.min(...corners.map((c) => c.x)),
		minY: Math.min(...corners.map((c) => c.y)),
		maxX: Math.max(...corners.map((c) => c.x)),
		maxY: Math.max(...corners.map((c) => c.y)),
	};
}

export function getGlobalBounds(element: Svgx, transform: string): Bounds {
	const local = getLocalBounds(element);
	return transform ? transformBounds(local, transform) : local;
}

export function getLocalBounds(element: Svgx): Bounds {
	const props = element.props;
	const type = element.type;

	if (type === "rect" || type === "foreignObject" || type === "image") {
		const x = Number(props.x) || 0;
		const y = Number(props.y) || 0;
		const w = Number(props.width) || 0;
		const h = Number(props.height) || 0;
		return { empty: false, minX: x, minY: y, maxX: x + w, maxY: y + h };
	}

	if (type === "circle") {
		const cx = Number(props.cx) || 0;
		const cy = Number(props.cy) || 0;
		const r = Number(props.r) || 0;
		return {
			empty: false,
			minX: cx - r,
			minY: cy - r,
			maxX: cx + r,
			maxY: cy + r,
		};
	}

	if (type === "ellipse") {
		const cx = Number(props.cx) || 0;
		const cy = Number(props.cy) || 0;
		const rx = Number(props.rx) || 0;
		const ry = Number(props.ry) || 0;
		return {
			empty: false,
			minX: cx - rx,
			minY: cy - ry,
			maxX: cx + rx,
			maxY: cy + ry,
		};
	}

	if (type === "line") {
		const x1 = Number(props.x1) || 0;
		const y1 = Number(props.y1) || 0;
		const x2 = Number(props.x2) || 0;
		const y2 = Number(props.y2) || 0;
		return {
			empty: false,
			minX: Math.min(x1, x2),
			minY: Math.min(y1, y2),
			maxX: Math.max(x1, x2),
			maxY: Math.max(y1, y2),
		};
	}

	if (type === "polygon" || type === "polyline") {
		const nums = String(props.points ?? "")
			.trim()
			.split(/[\s,]+/)
			.filter((s) => s !== "")
			.map(Number);
		let bounds: Bounds = emptyBounds;
		for (let i = 0; i + 1 < nums.length; i += 2) {
			const [x, y] = [nums[i], nums[i + 1]];
			if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
			bounds = unionBounds(bounds, {
				empty: false,
				minX: x,
				minY: y,
				maxX: x,
				maxY: y,
			});
		}
		return bounds;
	}

	if (!shouldRecurseIntoChildren(element)) return emptyBounds;
	const children = props.children as React.ReactNode;
	if (children == null) return emptyBounds;

	let bounds: Bounds = emptyBounds;
	for (const child of React.Children.toArray(children) as Svgx[]) {
		if (!React.isValidElement(child)) continue;
		const childBounds = getLocalBounds(child);

		const childTransform = child.props.transform;
		const transformed = childTransform
			? transformBounds(childBounds, childTransform)
			: childBounds;

		bounds = unionBounds(bounds, transformed);
	}

	return bounds;
}

export function boundsCenter(bounds: Bounds & { empty: false }): Vec2 {
	return Vec2((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
}
