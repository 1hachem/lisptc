import { type SetStateAction, useCallback, useRef, useState } from "react";

export function useStateWithRef<T>(
	initialState: T | (() => T),
): [T, (action: SetStateAction<T>) => void, React.RefObject<T>] {
	const [state, setState] = useState(initialState);
	const ref = useRef(state);
	ref.current = state;

	const setStateAndRef = useCallback((action: SetStateAction<T>) => {
		const newValue =
			typeof action === "function"
				? (action as (prev: T) => T)(ref.current)
				: action;
		ref.current = newValue;
		setState(newValue);
	}, []);

	return [state, setStateAndRef, ref];
}
