import {
	type MigrationFunctionReference,
	Migrations,
} from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";
import { internalMutation } from "./_generated/server.js";

export const migrations = new Migrations<DataModel>(components.migrations);

export const run = migrations.runner();

export const dropPreferencesBeforeWorkspaces = migrations.define({
	table: "preferences",
	migrateOne: async (ctx, row) => {
		if (row.workspaceId === undefined) await ctx.db.delete(row._id);
	},
});

const SERIES: MigrationFunctionReference[] = [
	internal.migrations.dropPreferencesBeforeWorkspaces,
];

export const runAll = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		await migrations.runSerially(ctx, SERIES);
		return null;
	},
});
