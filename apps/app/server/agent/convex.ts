import { webEnv } from "@repo/env/web";
import { ConvexHttpClient } from "convex/browser";
import {
	type FunctionArgs,
	type FunctionReference,
	type FunctionReturnType,
	getFunctionName,
	makeFunctionReference,
} from "convex/server";
import type { Session } from "./session.ts";

export function convexAs(session: Session): ConvexHttpClient {
	const client = new ConvexHttpClient(webEnv.CONVEX_URL);
	client.setAuth(session.token);
	return client;
}

type ServerMutation = FunctionReference<
	"mutation",
	"internal",
	{ subject: string }
>;

export interface ServerConvex {
	mutation<Ref extends ServerMutation>(
		ref: Ref,
		args: Omit<FunctionArgs<Ref>, "subject">,
	): Promise<FunctionReturnType<Ref>>;
}

export function convexAsServer(session: Session): ServerConvex {
	const client = new ConvexHttpClient(webEnv.CONVEX_URL) as ConvexHttpClient & {
		setAdminAuth(key: string): void;
	};
	client.setAdminAuth(webEnv.CONVEX_SELF_HOSTED_ADMIN_KEY);
	return {
		mutation: (ref, args) =>
			client.mutation(makeFunctionReference<"mutation">(getFunctionName(ref)), {
				...args,
				subject: session.subject,
			}),
	};
}
