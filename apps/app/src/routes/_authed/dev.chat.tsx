import { createFileRoute, notFound } from "@tanstack/react-router";
import { lazy } from "react";

const ChatPlayground = lazy(() =>
	import("../../components/chat-playground.tsx").then((m) => ({
		default: m.ChatPlayground,
	})),
);

export const Route = createFileRoute("/_authed/dev/chat")({
	beforeLoad: () => {
		if (!import.meta.env.DEV) throw notFound();
	},
	component: ChatPlayground,
});
