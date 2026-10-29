import type { ConvexQueryClient } from "@convex-dev/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import {
	authToken,
	dropAuthCookies,
	requestCarriesAuthCookie,
	requestFromDesktop,
} from "../../server/auth.ts";
import { verifyToken } from "../../server/token.ts";
import { rejectsSession } from "../components/route-error.tsx";

type SsrAuth =
	| { source: "server"; token: string | null; desktop: boolean }
	| { source: "browser" };

export const ssrAuth = createIsomorphicFn()
	.server(async (): Promise<SsrAuth> => {
		const desktop = requestFromDesktop();
		if (!requestCarriesAuthCookie())
			return { source: "server", token: null, desktop };
		const token = await authToken();
		if (token === undefined) return { source: "server", token: null, desktop };
		const verdict = await verifyToken(token);
		if (!verdict.signed && verdict.forged) {
			dropAuthCookies();
			return { source: "server", token: null, desktop };
		}
		return { source: "server", token, desktop };
	})
	.client((): SsrAuth => ({ source: "browser" }));

const forgetSession = createIsomorphicFn()
	.server((): void => dropAuthCookies())
	.client((): void => undefined);

export function dropRejectedSession(
	error: unknown,
	convexQueryClient: ConvexQueryClient,
): void {
	if (!rejectsSession(error)) throw error;
	convexQueryClient.serverHttpClient?.clearAuth();
	forgetSession();
}
