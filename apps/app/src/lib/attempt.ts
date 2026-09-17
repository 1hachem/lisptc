import { useCallback, useState } from "react";
import { reportIssue } from "./analytics.tsx";

export function useAttempt(source: string): {
	failure: string | null;
	attempt: (work: () => Promise<unknown>) => void;
} {
	const [failure, setFailure] = useState<string | null>(null);

	const attempt = useCallback(
		(work: () => Promise<unknown>) => {
			setFailure(null);
			void work().catch((ex: unknown) => {
				reportIssue(ex, { $exception_source: source });
				console.warn(`${source} failed:`, ex);
				setFailure(ex instanceof Error ? ex.message : String(ex));
			});
		},
		[source],
	);

	return { failure, attempt };
}
