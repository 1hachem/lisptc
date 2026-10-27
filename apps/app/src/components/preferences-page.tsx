import { useAppearance } from "../lib/appearance.tsx";
import { preferencesSource } from "../lib/files.ts";
import {
	usePanelMotion,
	useTraceBesideChat,
	useTraceLink,
} from "../lib/preferences.ts";
import { useSidebarMotion, useSidebarOrder } from "../lib/sidebar.ts";
import { useUI } from "../lib/ui.tsx";
import { FileView } from "./file-view.tsx";

export function PreferencesPage() {
	const { font, openFontPicker } = useAppearance();
	const { metaShown, inputOn } = useUI();
	const { order, hidden } = useSidebarOrder();
	const { motion } = useSidebarMotion();
	const { panelMotion } = usePanelMotion();
	const { traceBesideChat } = useTraceBesideChat();
	const { traceLink } = useTraceLink();

	return (
		<FileView
			file={{
				path: "preferences.ptc",
				source: preferencesSource({
					font: font.id,
					metadata: metaShown,
					input: inputOn,
					sidebar: order,
					hidden,
					motion,
					panelMotion,
					traceBesideChat,
					traceLink,
				}),
			}}
			actions={
				<button
					type="button"
					onClick={openFontPicker}
					className="flex-none cursor-pointer hover:text-fg"
				>
					change font
				</button>
			}
		/>
	);
}
