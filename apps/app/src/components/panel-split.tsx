import { DropPreview, SplitView, useNativeDrag } from "@repo/components";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@repo/ui";
import { type DragEvent, type ReactNode, useState } from "react";
import {
	type Dock,
	PANEL_DRAG,
	readPanelDrag,
	tabLabel,
} from "../lib/panel-ops.ts";
import { hasTabs, usePanels } from "../lib/panels.tsx";
import { PanelTab } from "./panel-tab.tsx";

const EXTERNAL = { type: PANEL_DRAG, read: readPanelDrag };

const BELOW_FROM = 0.7;

const LANDS: Record<Dock, string> = {
	side: "inset-y-0 right-0 w-1/2",
	below: "inset-x-0 bottom-0 h-1/2",
};

function landingLabel(target: Dock, open: boolean, docked: Dock): string {
	if (open && target === docked) return "add as a tab in the panel";
	if (open)
		return target === "below"
			? "move the panel below the chat"
			: "move the panel beside the chat";
	return target === "below" ? "open below the chat" : "open beside the chat";
}

function landingAt(event: DragEvent<HTMLElement>): Dock {
	const box = event.currentTarget.getBoundingClientRect();
	return event.clientY - box.top > box.height * BELOW_FROM ? "below" : "side";
}

function carriesPanel(event: DragEvent<HTMLElement>): boolean {
	return event.dataTransfer.types.includes(PANEL_DRAG);
}

function ChatDropZones({ open, docked }: { open: boolean; docked: Dock }) {
	const dragging = useNativeDrag(PANEL_DRAG);
	const { dockTab } = usePanels();
	const [landing, setLanding] = useState<Dock | null>(null);
	if (!dragging) return null;
	return (
		<>
			<section
				data-drop="chat"
				aria-label="drop to open in the panel"
				className="absolute inset-0 z-30"
				onDragOver={(event) => {
					if (!carriesPanel(event)) return;
					event.preventDefault();
					event.dataTransfer.dropEffect = "copy";
					setLanding(landingAt(event));
				}}
				onDragLeave={(event) => {
					if (event.currentTarget.contains(event.relatedTarget as Node | null))
						return;
					setLanding(null);
				}}
				onDrop={(event) => {
					setLanding(null);
					if (!carriesPanel(event)) return;
					event.preventDefault();
					const tab = readPanelDrag(event.dataTransfer);
					if (tab) dockTab(tab, landingAt(event));
				}}
			/>
			{landing && (
				<>
					<DropPreview className={`z-30 ${LANDS[landing]}`} />
					<div
						className={`pointer-events-none absolute z-30 flex items-center justify-center text-accent ${LANDS[landing]}`}
					>
						{landingLabel(landing, open, docked)}
					</div>
				</>
			)}
		</>
	);
}

export function PanelSplit({ children }: { children: ReactNode }) {
	const { layout, change } = usePanels();
	const open = hasTabs(layout);
	const docked = layout.dock ?? "side";
	return (
		<ResizablePanelGroup
			orientation={docked === "below" ? "vertical" : "horizontal"}
			className="min-h-0 flex-1"
		>
			<ResizablePanel id="chat" minSize="25%">
				<div className="relative flex h-full min-h-0 min-w-0 flex-col">
					{children}
					<ChatDropZones open={open} docked={docked} />
				</div>
			</ResizablePanel>
			{open && (
				<>
					<ResizableHandle />
					<ResizablePanel id="panel" defaultSize="50%" minSize="20%">
						<SplitView
							layout={layout}
							onChange={change}
							renderTab={(content, id) => (
								<PanelTab id={id} content={content} />
							)}
							tabLabel={tabLabel}
							external={EXTERNAL}
						/>
					</ResizablePanel>
				</>
			)}
		</ResizablePanelGroup>
	);
}
