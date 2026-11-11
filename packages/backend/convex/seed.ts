import { v } from "convex/values";
import { components } from "./_generated/api.js";
import { internalAction } from "./_generated/server.js";
import { createAuth } from "./auth.js";

export const account = internalAction({
	args: { email: v.string(), password: v.string() },
	returns: v.null(),
	handler: async (ctx, { email, password }) => {
		const existing = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: "user",
			where: [{ field: "email", value: email }],
		});
		if (existing !== null) return null;
		await createAuth(ctx).api.signUpEmail({
			body: { email, password, name: email },
		});
		return null;
	},
});
