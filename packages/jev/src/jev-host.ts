import { jevSpec } from "@repo/env/decisions";
import type { DecisionsSpec } from "@repo/shared/providers";
import { type Fetch, TypeSafeClient } from "@typesafe-ai/sdk";
import type { JevHost } from "./jev.ts";

const SYSTEM_ONE = "/v1/systemone";

function routed(endpoint: URL): Fetch {
	return (input, init) => {
		const url = new URL(input);
		return globalThis.fetch(url.pathname === SYSTEM_ONE ? endpoint : url, init);
	};
}

function client(spec: DecisionsSpec): TypeSafeClient {
	if (spec.apiKey === undefined)
		throw new Error(
			`${spec.apiKeyEnv.join(" or ")} is not set — add it to your environment (.env) to ask ${spec.label}.`,
		);
	const endpoint = new URL(spec.endpoint);
	return new TypeSafeClient({
		apiKey: spec.apiKey,
		baseURL: endpoint.origin,
		defaultModel: spec.model,
		timeout: spec.timeoutMs,
		fetch: routed(endpoint),
	});
}

export function jevClient(spec: DecisionsSpec = jevSpec): JevHost {
	let asked: TypeSafeClient | undefined;
	const open = (): TypeSafeClient => {
		if (asked === undefined) asked = client(spec);
		return asked;
	};
	return { ask: (request) => open().systemOne(request) };
}

export const jevHost: JevHost = jevClient();
