import { createFileRoute } from "@tanstack/react-router";
import { FileView } from "../../../components/file-view.tsx";
import { useAppearance } from "../../../lib/appearance.tsx";
import { preferencesSource } from "../../../lib/files.ts";
import { useSidebarMotion, useSidebarOrder } from "../../../lib/sidebar.ts";
import { useUI } from "../../../lib/ui.tsx";

export const Route = createFileRoute("/_authed/$workspaceId/preferences")({
	component: PreferencesFile,
});

function PreferencesFile() {
	const { theme, font, openThemePicker, openFontPicker } = useAppearance();
	const { shown, metaShown } = useUI();
	const { order } = useSidebarOrder();
	const { motion } = useSidebarMotion();

	return (
		<FileView
			file={{
				path: "preferences.ptc",
				source: preferencesSource({
					theme: theme.id,
					font: font.id,
					channels: shown,
					metadata: metaShown,
					sidebar: order,
					motion,
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
