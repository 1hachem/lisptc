import * as d3Ease from "d3-ease";
import { assertNever } from "./utils/assert";

export type Transition = {
	easing: "cubic-out" | "elastic-out" | ((t: number) => number);
	duration: number;
};

export function applyEasing(
	{ easing, duration }: Transition,
	t: number,
): number {
	const easingFunction =
		typeof easing === "function"
			? easing
			: easing === "cubic-out"
				? d3Ease.easeCubicOut
				: easing === "elastic-out"
					? d3Ease.easeElasticOut
					: assertNever(easing);
	return easingFunction(t / duration);
}

export type TransitionLike =
	| Transition
	| Transition["easing"]
	| Transition["duration"]
	| boolean
	| undefined;

export function resolveTransitionLike(t: TransitionLike): Transition | false {
	if (t === false) return false;
	if (typeof t === "object") {
		return t;
	}
	const transition: Transition = {
		easing: "cubic-out",
		duration: 200,
	};
	if (typeof t === "string" || typeof t === "function") {
		transition.easing = t;
	} else if (typeof t === "number") {
		transition.duration = t;
	} else if (t === true || t === undefined) {
	} else {
		assertNever(t);
	}
	return transition;
}
