import { type ErrorComponentProps, Link } from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import { useEffect } from "react";
import { reportIssue } from "../lib/analytics.tsx";
import { authClient } from "../lib/auth-client.ts";
import { EverythingFine } from "./everything-fine.tsx";

const REJECTED_TOKEN = /InvalidAuthHeader|Could not verify OIDC token/;

const SIGNED_OUT_CODES = new Set(["UNAUTHENTICATED", "NOT_PROVISIONED"]);

export function rejectsSession(error: unknown): boolean {
	if (error instanceof ConvexError)
		return (
			typeof error.data === "object" &&
			error.data !== null &&
			"code" in error.data &&
			SIGNED_OUT_CODES.has(String(error.data.code))
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
