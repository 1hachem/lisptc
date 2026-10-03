import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { API_URL, apiHeaders } from "../lib/api.ts";
import { callbackState, storeApproval } from "../lib/oauth-callback.ts";

export const Route = createFileRoute("/oauth/callback")({
	component: OAuthCallback,
});

type Outcome = "pending" | "approved" | "failed";

async function finishCallback(url: string): Promise<string | null> {
	const response = await fetch(`${API_URL}/api/oauth/callback`, {
		method: "POST",
		headers: await apiHeaders(),
		body: JSON.stringify({ url }),
	}).catch(() => null);
	if (response === null) return "the server could not be reached";
	if (response.ok) return null;
	const body = (await response.json().catch(() => null)) as {
		error?: unknown;
	} | null;
	return typeof body?.error === "string"
		? body.error
		: `the server answered ${response.status}`;
}

function OAuthCallback() {
	const [outcome, setOutcome] = useState<Outcome>("pending");
	const [reason, setReason] = useState<string | null>(null);
	const handled = useRef(false);

	useEffect(() => {
		if (handled.current) return;
		handled.current = true;
		const url = window.location.href;
		const params = new URL(url).searchParams;
		const error = params.get("error");
		const state = callbackState(url);
		window.history.replaceState(null, "", window.location.pathname);
		if (error || !params.get("code") || !state) {
			setReason(params.get("error_description") ?? error);
			setOutcome("failed");
			return;
		}
		void finishCallback(url).then((failure) => {
			if (failure !== null) {
				setReason(failure);
				setOutcome("failed");
				return;
			}
			storeApproval(state);
			setOutcome("approved");
		});
	}, []);

	return (
		<main className="flex min-h-svh items-center justify-center p-6">
			<div className="max-w-sm space-y-3 text-center">
				{outcome === "pending" && <p>Finishing authorization…</p>}
				{outcome === "approved" && (
					<>
						<h1 className="font-semibold text-lg">Authorization approved</h1>
						<p className="text-muted-foreground text-sm">
							Your chat picks this up on its own. You can close this tab.
						</p>
					</>
				)}
				{outcome === "failed" && (
					<>
						<h1 className="font-semibold text-lg">Authorization failed</h1>
						<p className="text-muted-foreground text-sm">
							{reason ?? "The redirect carried no authorization code."} Ask the
							agent for a new login link.
						</p>
					</>
				)}
				<Link to="/" className="text-sm underline">
					Back to the app
				</Link>
			</div>
		</main>
	);
}
