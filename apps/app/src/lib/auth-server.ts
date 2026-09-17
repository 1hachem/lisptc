import { createIsomorphicFn } from "@tanstack/react-start";
import { authToken } from "../../server/auth.ts";

export const ssrAuthToken = createIsomorphicFn()
	.server(async (): Promise<string | undefined> => await authToken())
	.client(async (): Promise<string | undefined> => undefined);
