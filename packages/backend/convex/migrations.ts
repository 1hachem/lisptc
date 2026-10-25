import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";
import { retiredModelReset } from "./lib/models.js";
import { MAX_WORKSPACES } from "./workspaces.js";

export const migrations = new Migrations<DataModel>(components.migrations);

export const run = migrations.runner();

export const resetRetiredModels = migrations.define({
	table: "workspaces",
	migrateOne: (_ctx, workspace) => retiredModelReset(workspace.model),
});

export const resetDigitalOceanGemma = migrations.define({
	table: "workspaces",
	migrateOne: (_ctx, workspace) => retiredModelReset(workspace.model),
});

export const moveThemeToWorkspaces = migrations.define({
	table: "preferences",
	migrateOne: async (ctx, preferences) => {
		if (preferences.theme === undefined) return;
		const owned = await ctx.db
			.query("workspaces")
			.withIndex("by_owner", (q) => q.eq("ownerId", preferences.userId))
			.take(MAX_WORKSPACES);
		for (const workspace of owned)
			if (workspace.theme === undefined)
				await ctx.db.patch(workspace._id, { theme: preferences.theme });
		return { theme: undefined };
	},
});

export const dropChannelToggles = migrations.define({
	table: "preferences",
	migrateOne: (_ctx, preferences) =>
		preferences.channels === undefined ? undefined : { channels: undefined },
});

export const runAll = migrations.runner([
	internal.migrations.resetRetiredModels,
	internal.migrations.resetDigitalOceanGemma,
	internal.migrations.moveThemeToWorkspaces,
	internal.migrations.dropChannelToggles,
]);
