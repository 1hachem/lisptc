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

const TOKEN_REUSE_MS = 5_000;

export function shareRecent<T>(
	fetch: () => Promise<T>,
	now: () => number,
	reuseMs: number,
): () => Promise<T> {
	let last: { at: number; result: Promise<T> } | undefined;
	return () => {
		if (last !== undefined && now() - last.at < reuseMs) return last.result;
		const result = fetch();
		const entry = { at: now(), result };
		last = entry;
		result.catch(() => {
			if (last === entry) last = undefined;
		});
		return result;
	};
}

const convexToken = shareRecent(
	() => authClient.convex.token({ fetchOptions: { throw: false } }),
	Date.now,
	TOKEN_REUSE_MS,
);

export const providerClient = new Proxy(authClient, {
	get(target, key, receiver) {
		if (key === "convex") return { token: convexToken };
		return Reflect.get(target, key, receiver);
	},
}) as unknown as AuthClient;
