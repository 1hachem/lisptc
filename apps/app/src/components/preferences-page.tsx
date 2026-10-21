import { useAppearance } from "../lib/appearance.tsx";
import { preferencesSource } from "../lib/files.ts";
import { usePanelMotion } from "../lib/preferences.ts";
import { useSidebarMotion, useSidebarOrder } from "../lib/sidebar.ts";
import { useUI } from "../lib/ui.tsx";
import { FileView } from "./file-view.tsx";

export function PreferencesPage() {
	const { theme, font, openThemePicker, openFontPicker } = useAppearance();
	const { shown, metaShown, inputOn, sendLabel } = useUI();
	const { order, hidden } = useSidebarOrder();
	const { motion } = useSidebarMotion();
	const { panelMotion } = usePanelMotion();

	return (
		<FileView
			file={{
				path: "preferences.ptc",
				source: preferencesSource({
					theme: theme.id,
					font: font.id,
					channels: shown,
					metadata: metaShown,
					input: inputOn,
					sendLabel,
					sidebar: order,
					hidden,
					motion,
					panelMotion,
				}),
			}}
			actions={
				<>
					<button
						type="button"
						onClick={openThemePicker}
						className="flex-none cursor-pointer hover:text-fg"
					>
						change theme
					</button>
					<button
						type="button"
						onClick={openFontPicker}
						className="flex-none cursor-pointer hover:text-fg"
					>
						change font
					</button>
				</>
			}
		/>
	);
}
