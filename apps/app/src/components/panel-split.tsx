import { SplitView } from "@repo/components";
import type { ReactNode } from "react";
import { PANEL_DRAG, readPanelDrag, tabLabel } from "../lib/panel-ops.ts";
import { usePanels } from "../lib/panels.tsx";
import { PanelTab } from "./panel-tab.tsx";

const EXTERNAL = { type: PANEL_DRAG, read: readPanelDrag };

export function PanelSplit({ children }: { children: ReactNode }) {
	const { layout, change } = usePanels();
	return (
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
			/>
		</div>
	);
}
