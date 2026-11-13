import { Delaunay as D3Delaunay } from "d3-delaunay";
import { assert, assertWarning } from "../utils/assert";
import { range } from "../utils/collections";
import { Vec2, type Vec2able } from "./vec2";

export class CoincidentPointsError extends Error {
	constructor(
		public readonly indexA: number,
		public readonly indexB: number,
	) {
		super(`Coincident points at indices ${indexA} and ${indexB}`);
		this.name = "CoincidentPointsError";
	}
}

export class Delaunay {
	private _inner: D3Delaunay<D3Delaunay.Point>;

	get d3(): D3Delaunay<D3Delaunay.Point> {
		return this._inner;
	}

	constructor(points: Vec2able[]) {
		this._inner = D3Delaunay.from(points.map((p) => Vec2(p).arr()));
		const inedges: Int32Array = (this._inner as any).inedges;
		const pts = this._inner.points;
		const n = pts.length / 2;
		for (let i = 0; i < n; i++) {
			if (inedges[i] !== -1) continue;
			for (let j = 0; j < n; j++) {
				if (j === i) continue;
				if (pts[2 * i] === pts[2 * j] && pts[2 * i + 1] === pts[2 * j + 1]) {
					throw new CoincidentPointsError(Math.min(i, j), Math.max(i, j));
				}
			}
			throw new Error(
				`Point ${i} was excluded from triangulation for unknown reasons`,
			);
		}
	}

	point(idx: number): Vec2 {
		return Vec2(this._inner.points[2 * idx], this._inner.points[2 * idx + 1]);
	}

	numPoints(): number {
		return this._inner.points.length / 2;
	}

	triangle(idx: number): Vec2[] {
		return [
			this.point(this._inner.triangles[3 * idx + 0]),
			this.point(this._inner.triangles[3 * idx + 1]),
			this.point(this._inner.triangles[3 * idx + 2]),
		];
	}

	numTriangles(): number {
		return this._inner.triangles.length / 3;
	}

	triangles(): Vec2[][] {
		if (this.numPoints() < 2) return [];
		return range(this.numTriangles()).map((i) => this.triangle(i));
	}

	findTriangle(pt: Vec2, { edge = 0, limit = Infinity } = {}): number {
		if (this.numPoints() < 3) return -1;

		if (isNaN(edge)) return -1;
		const { triangles, halfedges, points } = this._inner;
		const getPrev = (e: number) => (e % 3 === 0 ? e + 2 : e - 1);
		const getNext = (e: number) => (e % 3 === 2 ? e - 2 : e + 1);
		let current = edge,
			start = current,
			n = 0;

		while (true) {
			if (limit-- <= 0) return -1;

			const next = getNext(current);
			const pc = triangles[current] * 2;
			const pn = triangles[next] * 2;
			const o = orientation(
				points[pc],
				points[pc + 1],
				points[pn],
				points[pn + 1],
				pt.x,
				pt.y,
			);

			if (o >= 0) {
				if (start === (current = next)) break;
			} else {
				if (-1 === (current = halfedges[current])) break;
				start = current = ++n % 2 ? getNext(current) : getPrev(current);
			}
		}
		return current > -1 ? Math.floor(current / 3) : -1;
	}

	projectOntoConvexHull(pt: Vec2): ConvexHullProjection {
		if (this.numPoints() === 1) {
			const onlyPt = Vec2(this._inner.points[0], this._inner.points[1]);
			return {
				type: "vertex",
				ptIdx: 0,
				projectedPt: onlyPt,
				dist: pt.dist(onlyPt),
			};
		}

		const delPt = (idx: number) =>
			Vec2(this._inner.points[2 * idx], this._inner.points[2 * idx + 1]);

		const triIdx = this.findTriangle(pt);
		if (triIdx !== -1 && !d3DelaunayCollinearIdxs(this._inner)) {
			const ptIdx0 = this._inner.triangles[3 * triIdx + 0];
			const ptIdx1 = this._inner.triangles[3 * triIdx + 1];
			const ptIdx2 = this._inner.triangles[3 * triIdx + 2];
			const ptIdxSet = new Set([ptIdx0, ptIdx1, ptIdx2]);
			assert(ptIdxSet.size >= 2);
			if (ptIdxSet.size === 2) {
				const [ptIdx0, ptIdx1] = Array.from(ptIdxSet);
				const pt0 = delPt(ptIdx0);
				const pt1 = delPt(ptIdx1);
				const edge = pt1.sub(pt0);
				const edgeLen2 = edge.len2();
				assert(edgeLen2 > 0);
				const t = pt.sub(pt0).dot(edge) / edgeLen2;
				assertWarning(
					t >= 0 && t <= 1,
					"t out of range in projectOntoConvexHull",
				);
				return { type: "edge", ptIdx0, ptIdx1, t, projectedPt: pt, dist: 0 };
			} else {
				return {
					type: "triangle",
					ptIdx0,
					ptIdx1,
					ptIdx2,
					barycentric: barycentric(
						pt,
						delPt(ptIdx0),
						delPt(ptIdx1),
						delPt(ptIdx2),
					),
					projectedPt: pt,
					dist: 0,
				};
			}
		}

		const collinearIdxs = d3DelaunayCollinearIdxs(this._inner);
		const hull = collinearIdxs
			? [
					...collinearIdxs,
					...collinearIdxs.slice(1, collinearIdxs.length - 1).reverse(),
				]
			: this._inner.hull;
		const points = this._inner.points;
		const qx = pt.x,
			qy = pt.y;

		let bestDist2 = Infinity;
		let bestType: "vertex" | "edge" = "vertex";
		let bestPtIdx = 0;
		let bestPtIdx0 = 0;
		let bestPtIdx1 = 0;
		let bestT = 0;
		let bestX = 0;
		let bestY = 0;

		for (let i = 0; i < hull.length; i++) {
			const iA = hull[i];
			const iB = hull[(i + 1) % hull.length];
			const ax = points[2 * iA],
				ay = points[2 * iA + 1];
			const bx = points[2 * iB],
				by = points[2 * iB + 1];
			const abx = bx - ax,
				aby = by - ay;
			const ab2 = abx * abx + aby * aby;

			if (ab2 < 1e-10) {
				const d2 = (qx - ax) * (qx - ax) + (qy - ay) * (qy - ay);
				if (d2 < bestDist2) {
					bestDist2 = d2;
					bestType = "vertex";
					bestPtIdx = iA;
					bestX = ax;
					bestY = ay;
				}
				continue;
			}

			const t = Math.max(
				0,
				Math.min(1, ((qx - ax) * abx + (qy - ay) * aby) / ab2),
			);
			const px = ax + t * abx;
			const py = ay + t * aby;
			const d2 = (qx - px) * (qx - px) + (qy - py) * (qy - py);

			if (d2 < bestDist2) {
				bestDist2 = d2;
				bestX = px;
				bestY = py;
				if (t < 1e-6) {
					bestType = "vertex";
					bestPtIdx = iA;
				} else if (t > 1 - 1e-6) {
					bestType = "vertex";
					bestPtIdx = iB;
				} else {
					bestType = "edge";
					bestPtIdx0 = iA;
					bestPtIdx1 = iB;
					bestT = t;
				}
			}
		}

		const dist = Math.sqrt(bestDist2);
		const projectedPt = Vec2(bestX, bestY);
		if (bestType === "vertex") {
			return { type: "vertex", ptIdx: bestPtIdx, projectedPt, dist };
		} else {
			return {
				type: "edge",
				ptIdx0: bestPtIdx0,
				ptIdx1: bestPtIdx1,
				t: bestT,
				projectedPt,
				dist,
			};
		}
	}
}

function orientation(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	cx: number,
	cy: number,
) {
	return Math.sign((cx - bx) * (by - ay) - (cy - by) * (bx - ax));
}

function barycentric(pt: Vec2, p0: Vec2, p1: Vec2, p2: Vec2) {
	const x = pt.x;
	const y = pt.y;
	const x0 = p0.x;
	const y0 = p0.y;
	const x1 = p1.x;
	const y1 = p1.y;
	const x2 = p2.x;
	const y2 = p2.y;
	const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
	const l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / den;
	const l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / den;
	const l2 = 1 - l0 - l1;
	return { l0, l1, l2 };
}

function d3DelaunayCollinearIdxs(
	delaunay: D3Delaunay<D3Delaunay.Point>,
): number[] {
	return (delaunay as any).collinear;
}

export type ConvexHullProjection =
	| { type: "vertex"; ptIdx: number; projectedPt: Vec2; dist: number }
	| {
			type: "edge";
			ptIdx0: number;
			ptIdx1: number;
			t: number;
			projectedPt: Vec2;
			dist: number;
	  }
	| {
			type: "triangle";
			ptIdx0: number;
			ptIdx1: number;
			ptIdx2: number;
			barycentric: { l0: number; l1: number; l2: number };
			projectedPt: Vec2;
			dist: number;
	  };
