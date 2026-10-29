import { passkeyClient } from "@better-auth/passkey/client";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
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

export async function fetchConvexToken(): Promise<string | null> {
	return (await authToken()) ?? null;
}
