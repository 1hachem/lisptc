import type { DesktopPreferences } from "@repo/preferences-extension/ports";
import type { Id } from "../convex/_generated/dataModel.js";

export interface DesktopSettingsBridge {
	settings(
		userId: Id<"users">,
		change: Partial<DesktopPreferences>,
	): Promise<DesktopPreferences | undefined>;
}
