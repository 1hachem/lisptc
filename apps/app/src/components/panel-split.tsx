import { SplitView } from "@repo/components";
import type { ReactNode } from "react";
import {
	chatDocked,
	PANEL_DRAG,
	readPanelDrag,
	tabLabel,
} from "../lib/panel-ops.ts";
import { usePanels } from "../lib/panels.tsx";
import { usePanelMotion } from "../lib/preferences.ts";
import { IdleWorkspace } from "./idle-workspace.tsx";
import { MiniChat } from "./mini-chat.tsx";
import { PanelTab } from "./panel-tab.tsx";
import { StatusBar } from "./status-bar.tsx";

const EXTERNAL = { type: PANEL_DRAG, read: readPanelDrag };

export function PanelSplit({ children }: { children: ReactNode }) {
	const { layout, change, dockChat } = usePanels();
	const { panelMotion } = usePanelMotion();
	const docked = chatDocked(layout);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1">
				<SplitView
					layout={layout}
					onChange={change}
					renderTab={(content, id) =>
						content.kind === "main" ? (
							<div className="flex h-full min-h-0 min-w-0 flex-col">
								{children}
							</div>
						) : (
							<PanelTab id={id} content={content} />
						)
					}
					tabLabel={tabLabel}
					external={EXTERNAL}
					animated={panelMotion}
					placeholder={<IdleWorkspace />}
				/>
			</div>
			<StatusBar>
				{!docked && <MiniChat onDock={dockChat}>{children}</MiniChat>}
			</StatusBar>
		</div>
	);
}
