import type { ConvexHttpClient } from "convex/browser";
import type {
	FunctionArgs,
	FunctionReference,
	FunctionReturnType,
} from "convex/server";

export interface ServerClient {
	query<Query extends FunctionReference<"query", "internal">>(
		query: Query,
		args: FunctionArgs<Query>,
	): Promise<FunctionReturnType<Query>>;
	mutation<Mutation extends FunctionReference<"mutation", "internal">>(
		mutation: Mutation,
		args: FunctionArgs<Mutation>,
	): Promise<FunctionReturnType<Mutation>>;
}

interface AdminAuthed {
	setAdminAuth(adminKey: string): void;
}

export function serverClient(
	client: ConvexHttpClient,
	adminKey: string,
): ServerClient {
	(client as unknown as AdminAuthed).setAdminAuth(adminKey);
	return client as unknown as ServerClient;
}
