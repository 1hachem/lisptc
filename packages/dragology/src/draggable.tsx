import type { SetStateAction } from "react";
import { type DragSpec, DragSpecBuilder } from "./DragSpec";
import { getAtPath, type PathIn, setAtPath, type ValueAtPath } from "./paths";
import { type Svgx, updatePropsDownTree } from "./svgx";
import type { TransitionLike } from "./transition";

export type Draggable<T extends object> = (props: DraggableProps<T>) => Svgx;

export type DraggableProps<T extends object> = {
	state: T;
	d: DragSpecBuilder<T>;
	draggedId: string | null;
	setState: SetState<T>;
	isTracking: boolean;
	embed<const P extends PathIn<T, any>>(
		draggable: Draggable<ValueAtPath<T, P>>,
		path: P,
	): Svgx;
};

export function makeDraggableProps<T extends object>(fields: {
	state: T;
	draggedId: string | null;
	setState: SetState<T>;
	isTracking: boolean;
}): DraggableProps<T> {
	const props: DraggableProps<T> = {
		...fields,
		d: new DragSpecBuilder(fields.state),
		embed(draggable, path) {
			return embedImpl(draggable, props, path);
		},
	};
	return props;
}

export type SetState<T> = (
	newState: SetStateAction<T>,
	props?: {
		transition?: TransitionLike;
	},
) => void;

export type OnDragCallback<T extends object> = () => DragSpec<T>;

const DRAGOLOGY_PROP_NAME = "dragologyOnDrag";

export function getOnDragCallbackOnElement<T extends object>(
	element: Svgx,
): OnDragCallback<T> | undefined {
	const callback = element.props[DRAGOLOGY_PROP_NAME];
	return callback ? (callback as unknown as OnDragCallback<T>) : undefined;
}

function embedImpl<T extends object, const P extends PathIn<T, any>>(
	draggable: Draggable<ValueAtPath<T, P>>,
	props: DraggableProps<T>,
	path: P,
): Svgx {
	const subState = getAtPath(props.state, path as any) as ValueAtPath<T, P>;
	const subProps = makeDraggableProps({
		state: subState,
		draggedId: props.draggedId,
		setState: (action, options) => {
			props.setState((prev) => {
				const prevSub = getAtPath(prev, path as any) as ValueAtPath<T, P>;
				const newSub =
					typeof action === "function"
						? (action as (prev: ValueAtPath<T, P>) => ValueAtPath<T, P>)(
								prevSub,
							)
						: action;
				return setAtPath(prev, path as any, newSub);
			}, options);
		},
		isTracking: props.isTracking,
	});
	const rendered = draggable(subProps);
	return updatePropsDownTree(rendered, (el) => {
		const onDragCallback = getOnDragCallbackOnElement<any>(el);
		if (!onDragCallback) return;
		return {
			[DRAGOLOGY_PROP_NAME]: () => {
				const subSpec = onDragCallback();
				return props.d.substate(props.state, path as any, () => subSpec as any);
			},
		};
	});
}
