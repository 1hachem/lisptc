import { passkeyClient } from "@better-auth/passkey/client";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import type { AuthClient } from "@convex-dev/better-auth/react";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	plugins: [convexClient(), passkeyClient()],
});

export async function authToken(): Promise<string | undefined> {
	const { data } = await authClient.convex.token({
		fetchOptions: { throw: false },
	});
	return data?.token ?? undefined;
}

export const providerClient = authClient as unknown as AuthClient;
