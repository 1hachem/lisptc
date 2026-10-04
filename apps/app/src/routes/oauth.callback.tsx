import {
	Alert02Icon,
	CheckmarkCircle02Icon,
	Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { API_URL, apiHeaders } from "../lib/api.ts";
import {
	awaitingChat,
	callbackState,
	OAUTH_CHANNEL,
	type OAuthSignal,
	storeAuthorized,
} from "../lib/oauth-callback.ts";

export const Route = createFileRoute("/oauth/callback")({
	component: OAuthCallback,
});

const CHAT_ANSWER_MS = 700;
const CLOSE_AFTER_MS = 1200;

type Phase =
	| { kind: "finishing" }
	| { kind: "closing"; server: string }
	| { kind: "resumed"; server: string }
	| { kind: "orphaned"; server: string }
	| { kind: "failed"; reason: string };

type Finished = { server: string } | { failure: string };

async function finishCallback(url: string): Promise<Finished> {
	const response = await fetch(`${API_URL}/api/oauth/callback`, {
		method: "POST",
		headers: await apiHeaders(),
		body: JSON.stringify({ url }),
	}).catch(() => null);
	if (response === null) return { failure: "the server could not be reached" };
	const body = (await response.json().catch(() => null)) as {
		error?: unknown;
		server?: unknown;
	} | null;
	if (response.ok)
		return {
			server: typeof body?.server === "string" ? body.server : "the server",
		};
	return {
		failure:
			typeof body?.error === "string"
				? body.error
				: `the server answered ${response.status}`,
	};
}

function askChatToResume(state: string): Promise<boolean> {
	return new Promise((resolve) => {
		const channel = new BroadcastChannel(OAUTH_CHANNEL);
		const settle = (answered: boolean) => {
			clearTimeout(timer);
			channel.close();
			resolve(answered);
		};
		const timer = setTimeout(() => settle(false), CHAT_ANSWER_MS);
		channel.onmessage = (e: MessageEvent<OAuthSignal>) => {
			if (e.data.type === "answering" && e.data.state === state) settle(true);
		};
		channel.postMessage({ type: "authorized", state } satisfies OAuthSignal);
	});
}

function OAuthCallback() {
	const navigate = useNavigate();
	const [phase, setPhase] = useState<Phase>({ kind: "finishing" });
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
			setPhase({
				kind: "failed",
				reason:
					params.get("error_description") ??
					error ??
					"the redirect carried no authorization code.",
			});
			return;
		}
		void (async () => {
			const finished = await finishCallback(url);
			if ("failure" in finished) {
				setPhase({ kind: "failed", reason: finished.failure });
				return;
			}
			const { server } = finished;
			storeAuthorized(state);
			if (await askChatToResume(state)) {
				setPhase({ kind: "closing", server });
				setTimeout(() => {
					window.close();
					setPhase({ kind: "resumed", server });
				}, CLOSE_AFTER_MS);
				return;
			}
			const chat = awaitingChat(state);
			if (chat) {
				await navigate({
					to: "/$workspaceId/$chatId",
					params: chat,
					replace: true,
				});
				return;
			}
			setPhase({ kind: "orphaned", server });
		})();
	}, [navigate]);

	return (
		<main className="flex h-full items-center justify-center bg-bg p-6 font-mono text-[13px] text-fg">
			<div className="flex w-[320px] flex-col gap-3.5">
				<div className="text-orange">ptc</div>
				<Status phase={phase} />
				{phase.kind === "orphaned" || phase.kind === "failed" ? (
					<Link
						to="/"
						className="text-left text-[11.5px] text-dim hover:text-fg"
					>
						back to the app
					</Link>
				) : null}
			</div>
		</main>
	);
}

function Status({ phase }: { phase: Phase }) {
	switch (phase.kind) {
		case "finishing":
			return (
				<Panel
					icon={
						<HugeiconsIcon
							icon={Loading03Icon}
							size={16}
							strokeWidth={1.5}
							className="animate-spin text-dim"
						/>
					}
					title="connecting…"
				>
					finishing the authorization
				</Panel>
			);
		case "closing":
			return (
				<Panel icon={<Approved />} title={`${phase.server} connected`}>
					your chat is carrying on. closing this tab…
				</Panel>
			);
		case "resumed":
			return (
				<Panel icon={<Approved />} title={`${phase.server} connected`}>
					your chat is carrying on. you can close this tab.
				</Panel>
			);
		case "orphaned":
			return (
				<Panel icon={<Approved />} title={`${phase.server} connected`}>
					open the chat that asked for it and it carries on.
				</Panel>
			);
		case "failed":
			return (
				<Panel
					icon={
						<HugeiconsIcon
							icon={Alert02Icon}
							size={16}
							strokeWidth={1.5}
							className="text-red"
						/>
					}
					title="authorization failed"
				>
					{phase.reason} ask the agent for a new login link.
				</Panel>
			);
	}
}

function Approved() {
	return (
		<HugeiconsIcon
			icon={CheckmarkCircle02Icon}
			size={16}
			strokeWidth={1.5}
			className="text-green"
		/>
	);
}

function Panel({
	icon,
	title,
	children,
}: {
	icon: ReactNode;
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="flex items-start gap-2.5 bg-bg2 px-3 py-2.5">
			<div className="flex h-[18px] flex-none items-center">{icon}</div>
			<div className="flex min-w-0 flex-col gap-1">
				<div className="break-words">{title}</div>
				<div className="break-words text-[11.5px] text-dim">{children}</div>
			</div>
		</div>
	);
}
