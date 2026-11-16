import { PageView } from "./file-view.tsx";
import { PreferenceSections } from "./preference-sections.tsx";

export function PreferencesPage() {
	return (
		<PageView title="preferences">
			<div className="-mx-4 flex flex-col gap-5">
				<PreferenceSections />
			</div>
		</PageView>
	);
}
