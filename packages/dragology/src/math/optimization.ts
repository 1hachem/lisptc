import { adjPairs } from "../utils";
import { type Many, manyToArray } from "../utils/flexible-types";
import { FindMinimum } from "./cobyla";
import type { Vec2 } from "./vec2";

export class DistanceMinimizer {
	private curParams: number[];
	private readonly numConstraints: number;
	private scales: number[] | undefined;

	exploredValues: number[][] = [];
	exploredPositions: Vec2[] = [];

	constructor(initialParams: number[], numConstraints: number) {
		this.curParams = initialParams.slice();
		this.numConstraints = numConstraints;
	}

	get params(): number[] {
		return this.curParams;
	}

	private estimateScales(
		paramsToPoint: (params: number[]) => Vec2,
		baseParams: number[],
	): number[] {
		const n = baseParams.length;
		const basePos = paramsToPoint(baseParams);
		const eps = 1e-3;
		const scales: number[] = [];
		for (let i = 0; i < n; i++) {
			const perturbed = baseParams.slice();
			perturbed[i] += eps;
			const perturbedPos = paramsToPoint(perturbed);
			const sensitivity = perturbedPos.dist(basePos) / eps;
			scales[i] = Math.max(sensitivity, 0.01);
		}
		return scales;
	}

	minimize(
		target: Vec2,
		paramsToPoint: (params: number[]) => Vec2,
		options?: {
			constraints?: (params: number[]) => number[];
		},
	): number[] {
		const n = this.curParams.length;

		if (!this.scales) {
			this.scales = this.estimateScales(paramsToPoint, this.curParams);
		}
		const scales = this.scales;

		const toScaled = (params: number[]): number[] =>
			params.map((v, i) => v * scales[i]);
		const fromScaled = (scaled: number[]): number[] =>
			scaled.map((v, i) => v / scales[i]);

		const sx = toScaled(this.curParams);

		if (sx.every((v) => v === 0)) {
			(sx as number[])[0] = 1e-4;
		}

		const rhoend = 1e-3;
		const rhobeg = Math.max(1, paramsToPoint(fromScaled(sx)).dist(target));

		const constraints = options?.constraints;

		this.exploredValues = [];
		this.exploredPositions = [];

		FindMinimum(
			(_n, _m, sxArr, con) => {
				const scaledParams: number[] = [];
				for (let i = 0; i < n; i++) scaledParams[i] = sxArr[i];
				const params = fromScaled(scaledParams);

				this.exploredValues.push(params.slice());

				const point = paramsToPoint(params);
				this.exploredPositions.push(point);
				const obj = point.dist2(target);

				if (constraints) {
					const gs = constraints(params);
					for (let k = 0; k < gs.length; k++) {
						con[k] = -gs[k];
					}
				}

				return obj;
			},
			n,
			this.numConstraints,
			sx,
			rhobeg,
			rhoend,
			0,
			200,
		);

		this.curParams = fromScaled(sx);
		return this.curParams;
	}
}

export function lessThan(a: number, b: number): number {
	return a - b;
}

export function moreThan(a: number, b: number): number {
	return b - a;
}

export function inOrder(nums: Many<number>[]): number[] {
	return adjPairs(manyToArray(nums)).map(([a, b]) => lessThan(a, b));
}

export function and(...constraints: number[]): number[] {
	return constraints;
}
