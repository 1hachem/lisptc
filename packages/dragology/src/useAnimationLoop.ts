import { useEffect, useRef } from "react";

export function useAnimationLoop(callback: () => void) {
	const callbackRef = useRef(callback);
	callbackRef.current = callback;

	useEffect(() => {
		let requestId: number;

		const loop = () => {
			callbackRef.current();
			requestId = requestAnimationFrame(loop);
		};

		requestId = requestAnimationFrame(loop);

		return () => {
			cancelAnimationFrame(requestId);
		};
	}, []);
}
