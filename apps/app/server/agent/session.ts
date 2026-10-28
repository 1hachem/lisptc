import { createMiddleware } from "@tanstack/react-start";
import { verifyToken as verify } from "../token.ts";
import { edge } from "./edge.ts";
import { HttpError } from "./error.ts";

export interface Session {
	token: string;
	subject: string;
}

function bearer(header: string | null): string {
	if (header === null || !header.toLowerCase().startsWith("bearer ")) return "";
	return header.slice(7).trim();
}

export async function verifyToken(token: string): Promise<Session | null> {
	const verdict = await verify(token);
	if (!verdict.signed || verdict.subject === undefined) return null;
	return { token, subject: verdict.subject };
}

const session = createMiddleware({ type: "request" }).server(
	async ({ request, next }) => {
		const token = bearer(request.headers.get("authorization"));
		if (token === "") {
			throw new HttpError(401, "missing bearer token");
		}
		const current = await verifyToken(token);
		if (current === null) {
			throw new HttpError(401, "invalid bearer token");
		}
		return next({ context: { session: current } });
	},
);

export const authed = [...edge, session] as const;

export interface Authed<TBody> {
	request: Request;
	context: { session: Session; body: TBody };
}
