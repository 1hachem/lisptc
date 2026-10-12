import posthog from "posthog-js";
import { authToken } from "./auth-client.ts";

function distinctId(): string | undefined {
	return posthog.__loaded ? posthog.get_distinct_id() : undefined;
}

export async function apiHeaders(): Promise<Record<string, string>> {
	const id = distinctId();
	const token = await authToken();
	return {
		"content-type": "application/json",
		...(id ? { "x-distinct-id": id } : {}),
		...(token ? { authorization: `Bearer ${token}` } : {}),
	};
}
