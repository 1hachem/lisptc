import type { PanelOp, PanelStore } from "@repo/ui-extension";
import type { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs } from "convex/server";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

type StoredOp = FunctionArgs<typeof api.layouts.apply>["ops"][number];

export type LayoutClient = Pick<ConvexHttpClient, "mutation">;

export class ConvexLayoutStore implements PanelStore {
	constructor(
		private readonly workspaceId: Id<"workspaces">,
		private readonly connect: () => LayoutClient,
		private readonly chatId?: Id<"chats">,
	) {}

	async apply(ops: readonly PanelOp[]): Promise<void> {
		await this.connect().mutation(api.layouts.apply, {
			workspaceId: this.workspaceId,
			ops: ops.map((op) => this.placed(op)),
		});
	}

	private placed(op: PanelOp): StoredOp {
		if (
			op.op !== "open" ||
			op.content.kind !== "view" ||
			this.chatId === undefined
		)
			return op;
		return { ...op, content: { ...op.content, chatId: this.chatId } };
	}
}
