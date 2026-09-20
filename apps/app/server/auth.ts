import { convexBetterAuthReactStart } from "@convex-dev/better-auth/react-start";
import { appServerEnv } from "@repo/env/app";
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
		convexUrl: appServerEnv.CONVEX_URL,
		convexSiteUrl: appServerEnv.CONVEX_SITE_URL,
		jwtCache: { enabled: true, isAuthError },
	});
