import type { ConvexHttpClient } from "convex/browser";
import type {
	FunctionArgs,
	FunctionReference,
	FunctionReturnType,
	UserIdentityAttributes,
} from "convex/server";
import type { Id } from "../convex/_generated/dataModel.js";
import { ACTING_ISSUER } from "../convex/lib/acting.ts";

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
	setAdminAuth(adminKey: string, actingAs?: UserIdentityAttributes): void;
}

export function serverClient(
	client: ConvexHttpClient,
	adminKey: string,
): ServerClient {
	(client as unknown as AdminAuthed).setAdminAuth(adminKey);
	return client as unknown as ServerClient;
}

export interface Owner {
	readonly userId: Id<"users">;
	readonly workspaceId: Id<"workspaces">;
}

export function actingAs(
	client: ConvexHttpClient,
	adminKey: string,
	{ userId, workspaceId }: Owner,
): ConvexHttpClient {
	(client as unknown as AdminAuthed).setAdminAuth(adminKey, {
		issuer: ACTING_ISSUER,
		subject: userId,
		workspaceId,
	});
	return client;
}
