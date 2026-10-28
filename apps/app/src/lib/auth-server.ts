import { createIsomorphicFn } from "@tanstack/react-start";
import { authToken, dropAuthCookies } from "../../server/auth.ts";
import { verifyToken } from "../../server/token.ts";

type SsrAuth =
	| { source: "server"; token: string | null }
	| { source: "browser" };

export const ssrAuth = createIsomorphicFn()
	.server(async (): Promise<SsrAuth> => {
		const token = await authToken();
		if (token === undefined) return { source: "server", token: null };
		const verdict = await verifyToken(token);
		if (!verdict.signed && verdict.forged) {
			dropAuthCookies();
			return { source: "server", token: null };
		}
		return { source: "server", token };
	})
	.client((): SsrAuth => ({ source: "browser" }));

export const forgetSession = createIsomorphicFn()
	.server((): void => dropAuthCookies())
	.client((): void => undefined);
