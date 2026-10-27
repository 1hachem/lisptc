import { type ErrorComponentProps, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { reportIssue } from "../lib/analytics.tsx";
import { EverythingFine } from "./everything-fine.tsx";

export function RouteError({ error, reset }: ErrorComponentProps) {
	useEffect(() => {
		reportIssue(error, {
			$exception_source: "react",
			$current_url: window.location.href,
		});
	}, [error]);

	return (
		<EverythingFine>
			<div className="max-w-dialog whitespace-pre-wrap break-words text-red">
				{error instanceof Error ? error.message : String(error)}
			</div>
			<button
				type="button"
				onClick={reset}
				className="text-dim underline underline-offset-4 hover:text-fg"
			>
				try again
			</button>
		</EverythingFine>
	);
}

export function RouteNotFound() {
	return (
		<EverythingFine>
			<div>this page doesn't exist</div>
			<Link
				to="/"
				className="text-dim underline underline-offset-4 hover:text-fg"
			>
				go home
			</Link>
		</EverythingFine>
	);
}
