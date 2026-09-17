import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect } from "react";
import { reportIssue } from "../lib/analytics.tsx";

export function RouteError({ error, reset }: ErrorComponentProps) {
	useEffect(() => {
		reportIssue(error, {
			$exception_source: "react",
			$current_url: window.location.href,
		});
	}, [error]);

	return (
		<div className="flex flex-col items-start gap-3 p-8">
			<div className="whitespace-pre-wrap break-words text-red">
				{error instanceof Error ? error.message : String(error)}
			</div>
			<button
				type="button"
				onClick={reset}
				className="text-dim underline underline-offset-4 hover:text-fg"
			>
				try again
			</button>
		</div>
	);
}
