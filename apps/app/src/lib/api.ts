import { distinctId, sessionId } from "./analytics.tsx";
import { authToken } from "./auth-client.ts";

export async function apiHeaders(): Promise<Record<string, string>> {
	const id = distinctId();
	const session = sessionId();
	const token = await authToken();
	return {
		"content-type": "application/json",
		...(id ? { "x-distinct-id": id } : {}),
		...(session ? { "x-session-id": session } : {}),
		...(token ? { authorization: `Bearer ${token}` } : {}),
	};
}
