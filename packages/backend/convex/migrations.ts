import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";
import { retiredModelReset } from "./lib/models.js";

export const migrations = new Migrations<DataModel>(components.migrations);

export const run = migrations.runner();

export const resetRetiredModels = migrations.define({
	table: "workspaces",
	migrateOne: (_ctx, workspace) => retiredModelReset(workspace.model),
});
