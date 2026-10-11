import { webEnv } from "@repo/env/web";
import { createIsomorphicFn } from "@tanstack/react-start";

export const convexUrl = createIsomorphicFn()
	.server((): string => webEnv.CONVEX_URL)
	.client((): string => webEnv.VITE_CONVEX_URL);
