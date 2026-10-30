import { contentRegion } from "@repo/ui-catalog";
import { Preferences } from "./preferences-panel.tsx";

export function PreferencesPage() {
	return (
		<div {...contentRegion} className="contents">
			<Preferences />
		</div>
	);
}
