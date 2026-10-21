import { SplitView } from "@repo/components";
import { LeadChatProvider } from "../lib/lead-chat.tsx";
import { PANEL_DRAG, readPanelDrag, tabLabel } from "../lib/panel-ops.ts";
import { usePanels } from "../lib/panels.tsx";
import { usePanelMotion } from "../lib/preferences.ts";
import { IdleWorkspace } from "./idle-workspace.tsx";
import { MinimizedTray } from "./minimized-tray.tsx";
import { PanelTab } from "./panel-tab.tsx";

const EXTERNAL = { type: PANEL_DRAG, read: readPanelDrag };

export function PanelSplit() {
	const { layout, arrange, minimize } = usePanels();
	const { panelMotion } = usePanelMotion();
	return (
		<LeadChatProvider>
			<div className="flex min-h-0 flex-1 flex-col">
				<SplitView
					layout={layout}
					onChange={arrange}
					renderTab={(content, id) => <PanelTab id={id} content={content} />}
					tabLabel={tabLabel}
					external={EXTERNAL}
					animated={panelMotion}
					placeholder={<IdleWorkspace />}
					onMinimize={minimize}
					tray={(indicator) => <MinimizedTray indicator={indicator} />}
				/>
			</div>
		</LeadChatProvider>
	);
}
