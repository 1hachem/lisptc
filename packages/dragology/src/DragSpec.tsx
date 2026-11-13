import type { DragInitContext } from "./DragBehavior";
import type { OpClass, Operator } from "./op";
import { between } from "./ops/between";
import { changeFrame } from "./ops/changeFrame";
import { changeGap } from "./ops/changeGap";
import { changeResult } from "./ops/changeResult";
import { closest } from "./ops/closest";
import { custom } from "./ops/custom";
import { dropTarget } from "./ops/dropTarget";
import { during } from "./ops/during";
import { fixed } from "./ops/fixed";
import { onDrop } from "./ops/onDrop";
import { ReactToMethod } from "./ops/reactTo";
import { SubstateMethod } from "./ops/substate";
import { switchToStateAndFollow } from "./ops/switchToStateAndFollow";
import { VaryMethod, varyFunc } from "./ops/vary";
import { whenFar } from "./ops/whenFar";
import { withBranchTransition } from "./ops/withBranchTransition";
import { withChaining } from "./ops/withChaining";
import { withDropTransition } from "./ops/withDropTransition";
import { withFloating } from "./ops/withFloating";
import { withInitContext } from "./ops/withInitContext";
import { withOverlay } from "./ops/withOverlay";
import { withSnapRadius } from "./ops/withSnapRadius";
import type { PathIn } from "./paths";
import type { Transition } from "./transition";
import type { ManyReader } from "./utils/flexible-types";

export type DragSpecData<T extends object> = {
	opClass: OpClass<T, any[]>;
	args: unknown[];
};

export type Chaining<T extends object> = {
	draggedId?: string;
	followSpec?: DragSpec<T>;
	transition: Transition | false;
};

export type DragSpec<T extends object> = DragSpecData<T> &
	DragSpecMethods<T> &
	DragSpecBrand;

export type DragSpecLike<T extends object> = DragSpec<T> | T;

declare const _dragSpecBrand: unique symbol;
export type DragSpecBrand = { readonly [_dragSpecBrand]: true };

export class DragSpecMethods<T extends object> {
	get onDrop(): typeof onDrop<T> {
		return onDrop<T>;
	}

	get whenFar(): typeof whenFar<T> {
		return whenFar<T>;
	}

	get withSnapRadius(): typeof withSnapRadius<T> {
		return withSnapRadius<T>;
	}

	get withDropTransition(): typeof withDropTransition<T> {
		return withDropTransition<T>;
	}

	get withOverlay(): typeof withOverlay<T> {
		return withOverlay<T>;
	}

	get withBranchTransition(): typeof withBranchTransition<T> {
		return withBranchTransition<T>;
	}

	get changeFrame(): typeof changeFrame<T> {
		return changeFrame<T>;
	}

	get changeResult(): typeof changeResult<T> {
		return changeResult<T>;
	}

	get changeGap(): typeof changeGap<T> {
		return changeGap<T>;
	}

	get withFloating(): typeof withFloating<T> {
		return withFloating<T>;
	}

	get withChaining(): typeof withChaining<T> {
		return withChaining<T>;
	}

	get during(): typeof during<T> {
		return during<T>;
	}

	get withInitContext(): typeof withInitContext<T> {
		return withInitContext<T>;
	}

	with(
		this: DragSpec<T>,
		wrap: (spec: DragSpec<T>) => DragSpec<T>,
	): DragSpec<T> {
		return wrap(this);
	}
}

export function modifier<T extends object, A extends unknown[]>(
	modifierClass: new (
		ctx: DragInitContext<T>,
		inner: DragSpecData<T>,
		...args: A
	) => Operator<T>,
): (...args: A) => (spec: DragSpec<T>) => DragSpec<T> {
	const make = operator(modifierClass);
	return (...args) =>
		(spec) =>
			make(spec, ...args);
}

export function operator<T extends object, A extends unknown[]>(
	operatorClass: OpClass<T, A>,
): (...args: A) => DragSpec<T> {
	return (...args) =>
		attachMethods({
			opClass: operatorClass as OpClass<T, any[]>,
			args,
		});
}

function attachMethods<T extends object>(data: DragSpecData<T>): DragSpec<T> {
	return Object.assign(Object.create(DragSpecMethods.prototype), data);
}

function isDragSpec<T extends object>(
	value: DragSpecLike<T>,
): value is DragSpec<T> {
	return (
		typeof value === "object" &&
		value !== null &&
		Object.getPrototypeOf(value) === DragSpecMethods.prototype
	);
}

export function resolveDragSpecLike<T extends object>(
	specLike: DragSpecLike<T>,
): DragSpec<T> {
	if (isDragSpec(specLike)) return specLike;
	return fixed(specLike);
}

export class DragSpecBuilder<T extends object> {
	readonly state: T;

	constructor(state: T) {
		this.state = state;
	}

	get fixed(): typeof fixed<T> {
		return fixed<T>;
	}

	get between(): typeof between<T> {
		return between<T>;
	}

	get closest(): typeof closest<T> {
		return closest<T>;
	}

	get vary(): VaryMethod<T>["vary"] {
		return VaryMethod.prototype.vary;
	}

	get varyFunc(): typeof varyFunc<T> {
		return varyFunc<T>;
	}

	get custom(): typeof custom<T> {
		return custom<T>;
	}

	get dropTarget(): typeof dropTarget<T> {
		return dropTarget<T>;
	}

	get substate(): SubstateMethod<T>["substate"] {
		return SubstateMethod.prototype.substate;
	}

	get switchToStateAndFollow(): typeof switchToStateAndFollow<T> {
		return switchToStateAndFollow<T>;
	}

	get reactTo(): ReactToMethod<T>["reactTo"] {
		return ReactToMethod.prototype.reactTo;
	}
}

export type VaryOptions<T> = {
	constraint?: ManyReader<number, [T]>;
	pin?: ManyReader<number, [T]>;
};

const VARY_PATH = Symbol("VaryPath");

export type VaryPath<T> = { [VARY_PATH]: PathIn<T, number> };

export function param<T>(...segments: PathIn<T, number>): VaryPath<T> {
	return { [VARY_PATH]: segments };
}

export function resolveVaryPath<T>(p: VaryPath<T>): PathIn<T, number> {
	return p[VARY_PATH];
}
