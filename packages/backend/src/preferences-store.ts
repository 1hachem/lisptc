import type {
	Preferences,
	PreferencesStore,
} from "@repo/preferences-extension/ports";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export type PreferencesClient = Pick<ConvexHttpClient, "query" | "mutation">;

export class ConvexPreferencesStore implements PreferencesStore {
	constructor(
		private readonly workspaceId: Id<"workspaces">,
		private readonly connect: () => PreferencesClient,
	) {}

	async read(): Promise<Preferences> {
		const stored = await this.connect().query(api.preferences.get, {
			workspaceId: this.workspaceId,
		});
		const {
			font,
			metadata,
			input,
			sidebar,
			sidebarRight,
			hidden,
			statusBar,
			statusBarHidden,
			motion,
			panelMotion,
			traceBesideChat,
			traceLink,
		} = stored;
		return {
			font,
			metadata,
			input,
			sidebar,
			sidebarRight,
			hidden,
			statusBar,
			statusBarHidden,
			motion,
			panelMotion,
			traceBesideChat,
			traceLink,
		};
	}

	async write(change: Preferences): Promise<void> {
		await this.connect().mutation(api.preferences.put, {
			workspaceId: this.workspaceId,
			preferences: change,
		});
	}
}
