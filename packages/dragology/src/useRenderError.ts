import { useCallback, useState } from "react";

function useThrowRenderError() {
	const [error, setError] = useState<unknown>(null);

	if (error) {
		throw error;
	}

	return useCallback((err: unknown) => {
		setError(err);
		throw err;
	}, []);
}

export function useCatchToRenderError() {
	const throwRenderError = useThrowRenderError();

	return useCallback(
		function catchToRenderError<TArgs extends any[], TReturn>(
			fn: (...args: TArgs) => TReturn,
		) {
			return (...args: TArgs) => {
				try {
					return fn(...args);
				} catch (error) {
					return throwRenderError(error);
				}
			};
		},
		[throwRenderError],
	);
}

export type CatchToRenderError = ReturnType<typeof useCatchToRenderError>;
