import type {
	Preferences,
	PreferencesStore,
} from "@repo/preferences-extension/ports";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

export type PreferencesClient = Pick<ConvexHttpClient, "query" | "mutation">;

export class ConvexPreferencesStore implements PreferencesStore {
	constructor(private readonly connect: () => PreferencesClient) {}

	async read(): Promise<Preferences> {
		const stored = await this.connect().query(api.preferences.get, {});
		const {
			font,
			metadata,
			input,
			sendLabel,
			sidebar,
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
			sendLabel,
			sidebar,
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
			preferences: change,
		});
	}
}
