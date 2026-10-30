import { SplitView } from "@repo/components";
import { anchorOf } from "@repo/ui-catalog";
import { LeadChatProvider } from "../lib/lead-chat.tsx";
import {
	PANEL_DRAG,
	readPanelDrag,
	tabLabel,
	tabMinWidth,
} from "../lib/panel-ops.ts";
import { usePanels } from "../lib/panels.tsx";
import { usePanelMotion } from "../lib/preferences.ts";
import { IdleWorkspace } from "./idle-workspace.tsx";
import { PanelTab } from "./panel-tab.tsx";
import { StatusBar } from "./status-bar.tsx";

const EXTERNAL = { type: PANEL_DRAG, read: readPanelDrag };

const ANCHORS = {
	tab: anchorOf("panel/tab"),
	tabClose: anchorOf("panel/tab-close"),
	split: anchorOf("panel/split"),
	resize: anchorOf("panel/resize"),
	panes: anchorOf("status/panes"),
};

export function PanelSplit() {
	const { layout, arrange } = usePanels();
	const { panelMotion } = usePanelMotion();
	return (
		<LeadChatProvider>
			<div className="flex min-h-0 flex-1 flex-col">
				<SplitView
					layout={layout}
					onChange={arrange}
					renderTab={(content, id) => <PanelTab id={id} content={content} />}
					tabLabel={tabLabel}
					minWidth={tabMinWidth}
					external={EXTERNAL}
					animated={panelMotion}
					placeholder={<IdleWorkspace />}
					footer={(indicator) => <StatusBar indicator={indicator} />}
					anchors={ANCHORS}
				/>
			</div>
		</LeadChatProvider>
	);
}
