import { convexBetterAuthReactStart } from "@convex-dev/better-auth/react-start";
import { DESKTOP_USER_AGENT } from "@repo/desktop-protocol";
import { webEnv } from "@repo/env/web";
import { deleteCookie, getRequestHeader } from "@tanstack/react-start/server";
import { ConvexError } from "convex/values";

const UNAUTHENTICATED = new Set(["UNAUTHENTICATED", "NOT_PROVISIONED"]);

function isAuthError(error: unknown): boolean {
	return (
		error instanceof ConvexError &&
		typeof error.data === "object" &&
		error.data !== null &&
		"code" in error.data &&
		UNAUTHENTICATED.has(String(error.data.code))
	);
}

export const { handler: authHandler, getToken: authToken } =
	convexBetterAuthReactStart({
		convexUrl: webEnv.CONVEX_URL,
		convexSiteUrl: webEnv.CONVEX_SITE_URL,
		jwtCache: { enabled: true, isAuthError },
	});

const AUTH_COOKIES = ["convex_jwt", "session_token", "session_data"];

export function fromDesktop(userAgent: string | undefined): boolean {
	return userAgent?.includes(`${DESKTOP_USER_AGENT}/`) ?? false;
}

export function requestFromDesktop(): boolean {
	return fromDesktop(getRequestHeader("user-agent"));
}

export function dropAuthCookies(): void {
	for (const name of AUTH_COOKIES) {
		deleteCookie(`better-auth.${name}`, { path: "/" });
		deleteCookie(`__Secure-better-auth.${name}`, { path: "/", secure: true });
	}
}
