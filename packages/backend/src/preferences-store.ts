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
		if (stored === null) return {};
		const { theme, font, channels, metadata, sidebar, hidden, motion } = stored;
		return { theme, font, channels, metadata, sidebar, hidden, motion };
	}

	async write(change: Preferences): Promise<void> {
		await this.connect().mutation(api.preferences.put, {
			preferences: change,
		});
	}
}
