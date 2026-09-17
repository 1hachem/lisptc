import { passkey } from "@better-auth/passkey";
import { type AuthFunctions, createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import type { GenericCtx } from "@convex-dev/better-auth/utils";
import { betterAuth } from "better-auth/minimal";
import { components, internal } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";
import { env } from "./_generated/server.js";
import authConfig from "./auth.config.js";
import { slugify } from "./lib/slug.js";

const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel>(components.betterAuth, {
	authFunctions,
	triggers: {
		user: {
			onCreate: async (ctx, doc) => {
				const userId = await ctx.db.insert("users", {
					authId: doc._id,
					name: doc.name,
					email: doc.email,
					image: doc.image ?? undefined,
				});
				await ctx.db.insert("workspaces", {
					ownerId: userId,
					name: doc.name === "" ? doc.email : doc.name,
					slug: slugify(doc.name === "" ? doc.email : doc.name),
				});
			},
			onUpdate: async (ctx, newDoc) => {
				const user = await ctx.db
					.query("users")
					.withIndex("by_auth", (q) => q.eq("authId", newDoc._id))
					.unique();
				if (user === null) return;
				await ctx.db.patch(user._id, {
					name: newDoc.name,
					email: newDoc.email,
					image: newDoc.image ?? undefined,
				});
			},
			onDelete: async (ctx, doc) => {
				const user = await ctx.db
					.query("users")
					.withIndex("by_auth", (q) => q.eq("authId", doc._id))
					.unique();
				if (user === null) return;
				await ctx.db.delete(user._id);
				await ctx.scheduler.runAfter(0, internal.users.purge, {
					userId: user._id,
				});
			},
		},
	},
});

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

export const createAuth = (ctx: GenericCtx<DataModel>) =>
	betterAuth({
		baseURL: env.SITE_URL,
		trustedOrigins: [env.SITE_URL],
		database: authComponent.adapter(ctx),
		emailAndPassword: { enabled: true, requireEmailVerification: false },
		socialProviders: {
			...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
				? {
						github: {
							clientId: env.GITHUB_CLIENT_ID,
							clientSecret: env.GITHUB_CLIENT_SECRET,
						},
					}
				: {}),
			...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
				? {
						google: {
							clientId: env.GOOGLE_CLIENT_ID,
							clientSecret: env.GOOGLE_CLIENT_SECRET,
						},
					}
				: {}),
		},
		plugins: [
			passkey({
				rpID: new URL(env.SITE_URL).hostname,
				rpName: "lisptc",
				origin: env.SITE_URL,
			}),
			convex({ authConfig }),
		],
	});
