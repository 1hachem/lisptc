import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { callbackState, storeCallback } from "../lib/oauth-callback.ts";

export const Route = createFileRoute("/oauth/callback")({
	component: OAuthCallback,
});

type Outcome = "pending" | "handed-off" | "failed";

function OAuthCallback() {
	const [outcome, setOutcome] = useState<Outcome>("pending");
	const [reason, setReason] = useState<string | null>(null);

	useEffect(() => {
		const url = window.location.href;
		const params = new URL(url).searchParams;
		const error = params.get("error");
		if (error || !params.get("code") || !callbackState(url)) {
			setReason(params.get("error_description") ?? error);
			setOutcome("failed");
			return;
		}
		storeCallback(url);
		setOutcome("handed-off");
	}, []);

	return (
		<main className="flex min-h-svh items-center justify-center p-6">
			<div className="max-w-sm space-y-3 text-center">
				{outcome === "pending" && <p>Finishing authorization…</p>}
				{outcome === "handed-off" && (
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
