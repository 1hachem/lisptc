import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";
import { Landing } from "../components/landing.tsx";
import { inDesktopShell } from "../lib/desktop-shell.ts";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	const { isAuthenticated } = useConvexAuth();
	const [shell, setShell] = useState(false);

	useEffect(() => {
		setShell(inDesktopShell());
	}, []);

	if (isAuthenticated || shell) return <Navigate to="/app" replace />;
	return <Landing />;
}
