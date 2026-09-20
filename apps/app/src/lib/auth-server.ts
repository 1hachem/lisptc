import { createIsomorphicFn } from "@tanstack/react-start";
import { authToken } from "../../server/auth.ts";

export type SsrAuth =
	| { source: "server"; token: string | null }
	| { source: "browser" };

export const ssrAuth = createIsomorphicFn()
	.server(async (): Promise<SsrAuth> => {
		const token = await authToken();
		return { source: "server", token: token ?? null };
	})
	.client((): SsrAuth => ({ source: "browser" }));
