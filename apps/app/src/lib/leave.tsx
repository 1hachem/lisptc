import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useState } from "react";
import { flushSync } from "react-dom";
import { forgetUser, reportIssue } from "./analytics.tsx";

type Leave = {
	leaving: boolean;
	failure: string | null;
	leave: (end: () => Promise<void>) => Promise<void>;
};

const LeaveContext = createContext<Leave | null>(null);

export function useLeaveState(): Leave {
	const queryClient = useQueryClient();
	const [leaving, setLeaving] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	const leave = useCallback(
		async (end: () => Promise<void>) => {
			setFailure(null);
			flushSync(() => setLeaving(true));
			queryClient.removeQueries();
			try {
				await end();
				forgetUser();
			} catch (ex) {
				reportIssue(ex, { $exception_source: "leaving" });
				setFailure(ex instanceof Error ? ex.message : String(ex));
				setLeaving(false);
			}
		},
		[queryClient],
	);

	return { leaving, failure, leave };
}

export const LeaveProvider = LeaveContext.Provider;

export function useLeave(): Leave {
	const value = useContext(LeaveContext);
	if (value === null) throw new Error("useLeave outside LeaveProvider");
	return value;
}
