import { AsyncLocalStorage } from "node:async_hooks";
import { createMiddleware } from "@tanstack/react-start";
import { verifyToken } from "../token.ts";
import { edge } from "./edge.ts";
import { HttpError } from "./error.ts";

export interface Session {
	token: string;
	subject: string;
}

const inFlight = new AsyncLocalStorage<Session>();

export function currentSession(): Session {
	const found = inFlight.getStore();
	if (found === undefined) {
		throw new HttpError(401, "no session on this request");
	}
	return found;
}

function bearer(header: string | null): string {
	if (header === null || !header.toLowerCase().startsWith("bearer ")) return "";
	return header.slice(7).trim();
}

const session = createMiddleware({ type: "request" }).server(
	async ({ request, next }) => {
		const token = bearer(request.headers.get("authorization"));
		if (token === "") {
			throw new HttpError(401, "missing bearer token");
		}
		const verdict = await verifyToken(token);
		if (!verdict.signed || verdict.subject === undefined) {
			throw new HttpError(401, "invalid bearer token");
		}
		const current: Session = { token, subject: verdict.subject };
		return inFlight.run(current, () => next({ context: { session: current } }));
	},
);

export const authed = [...edge, session] as const;

export interface Authed<TBody> {
	request: Request;
	context: { session: Session; body: TBody };
}
