/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest, type TestConvex } from "convex-test";
import { components } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import schema from "../convex/schema.ts";

const modules = import.meta.glob("../convex/**/*.ts");

const HOUR = 60 * 60 * 1000;

export interface Signed {
	user: Id<"users">;
	workspace: Id<"workspaces">;
	as: TestConvex<typeof schema>;
}

export function harness(): TestConvex<typeof schema> {
	const t = convexTest(schema, modules);
	betterAuthTest.register(t);
	return t;
}

export async function signIn(
	t: TestConvex<typeof schema>,
	email: string,
): Promise<Signed> {
	const now = Date.now();
	const authId = await t.run(async (ctx) => {
		const created = await ctx.runMutation(
			components.betterAuth.adapter.create,
			{
				input: {
					model: "user",
					data: {
						name: email,
						email,
						emailVerified: true,
						createdAt: now,
						updatedAt: now,
					},
				},
			},
		);
		return (created as { _id: string })._id;
	});
	const sessionId = await t.run(async (ctx) => {
		const created = await ctx.runMutation(
			components.betterAuth.adapter.create,
			{
				input: {
					model: "session",
					data: {
						userId: authId,
						token: `token-${email}`,
						expiresAt: now + HOUR,
						createdAt: now,
						updatedAt: now,
					},
				},
			},
		);
		return (created as { _id: string })._id;
	});
	const { user, workspace } = await t.run(async (ctx) => {
		const user = await ctx.db.insert("users", {
			authId,
			name: email,
			email,
		});
		const workspace = await ctx.db.insert("workspaces", {
			ownerId: user,
			name: email,
			slug: email.replace(/[^a-z0-9]+/g, "-"),
		});
		return { user, workspace };
	});
	return {
		user,
		workspace,
		as: t.withIdentity({ subject: authId, sessionId }) as TestConvex<
			typeof schema
		>,
	};
}
