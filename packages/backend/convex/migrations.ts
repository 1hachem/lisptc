import {
	type MigrationFunctionReference,
	type MigrationStatus,
	Migrations,
} from "@convex-dev/migrations";
import { components, internal } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";
import { internalQuery } from "./_generated/server.js";
import { retiredModelReset } from "./lib/models.js";

export const migrations = new Migrations<DataModel>(components.migrations);

export const run = migrations.runner();

export const resetRetiredModels = migrations.define({
	table: "workspaces",
	migrateOne: (_ctx, workspace) => retiredModelReset(workspace.model),
});

const LIVE: MigrationFunctionReference[] = [
	internal.migrations.resetRetiredModels,
];

export const runLive = migrations.runner(LIVE);

export const liveStatus = internalQuery({
	args: {},
	handler: (ctx): Promise<MigrationStatus[]> =>
		migrations.getStatus(ctx, { migrations: LIVE }),
});
