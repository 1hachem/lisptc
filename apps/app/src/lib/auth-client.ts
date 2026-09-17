import { passkeyClient } from "@better-auth/passkey/client";
import {
	convexClient,
	crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";
import type { AuthClient } from "@convex-dev/better-auth/react";
import { webEnv } from "@repo/env/web";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: webEnv.VITE_API_URL,
	plugins: [convexClient(), crossDomainClient(), passkeyClient()],
});

export async function authToken(): Promise<string | undefined> {
	const { data } = await authClient.convex.token({
		fetchOptions: { throw: false },
	});
	return data?.token ?? undefined;
}

export const providerClient = authClient as unknown as AuthClient;
