import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";

export const migrations = new Migrations<DataModel>(components.migrations);

export const run = migrations.runner();

export const renameKwargs = migrations.define({
	table: "messages",
	migrateOne: (_ctx, message) =>
		message.kwargs === undefined
			? undefined
			: { additional_kwargs: message.kwargs, kwargs: undefined },
});

export const runRenameKwargs = migrations.runner(
	internal.migrations.renameKwargs,
);
