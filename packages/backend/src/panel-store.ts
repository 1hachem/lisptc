import type { PanelReader, PanelTab } from "@repo/ui-extension";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export type PanelClient = Pick<ConvexHttpClient, "query">;

export class ConvexPanelReader implements PanelReader {
	constructor(
		private readonly workspaceId: Id<"workspaces">,
		private readonly connect: () => PanelClient,
	) {}

	async tabs(): Promise<PanelTab[]> {
		const layout = await this.connect().query(api.layouts.get, {
			workspaceId: this.workspaceId,
		});
		if (layout === null) return [];
		return layout.nodes.flatMap((node) =>
			node.kind === "pane"
				? node.tabs.map((tab) => ({
						id: tab.id,
						kind: tab.content.kind,
						title:
							tab.content.kind === "file"
								? tab.content.name
								: tab.content.title,
						shown: node.active === tab.id,
						focused: node.active === tab.id && layout.focused === node.id,
					}))
				: [],
		);
	}
}
