import type { StoredView, ViewStore } from "@repo/ui-extension";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export type ViewClient = Pick<ConvexHttpClient, "mutation">;

export class ConvexViewStore implements ViewStore {
	constructor(
		private readonly chatId: Id<"chats">,
		private readonly connect: () => ViewClient,
	) {}

	async put({ viewId, node }: StoredView): Promise<void> {
		await this.connect().mutation(api.views.put, {
			chatId: this.chatId,
			viewId,
			node,
		});
	}
}
