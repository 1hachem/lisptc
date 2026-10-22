import type { ErrorComponentProps } from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import { useEffect } from "react";
import { reportIssue } from "../lib/analytics.tsx";
import { authClient } from "../lib/auth-client.ts";

const REJECTED_TOKEN = /InvalidAuthHeader|Could not verify OIDC token/;

export function rejectsSession(error: unknown): boolean {
	if (error instanceof ConvexError)
		return (
			typeof error.data === "object" &&
			error.data !== null &&
			"code" in error.data &&
			error.data.code === "UNAUTHENTICATED"
		);
	return error instanceof Error && REJECTED_TOKEN.test(error.message);
}

function useSignedOutTo(page: string, when: boolean) {
	useEffect(() => {
		if (!when) return;
		void authClient
			.signOut()
			.catch(() => undefined)
			.finally(() => window.location.replace(page));
	}, [page, when]);
}

export function RouteError({ error, reset }: ErrorComponentProps) {
	const rejected = rejectsSession(error);
	useSignedOutTo("/login", rejected);
	useEffect(() => {
		if (rejected) return;
		reportIssue(error, {
			$exception_source: "react",
			$current_url: window.location.href,
		});
	}, [error, rejected]);

	if (rejected) return null;
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
