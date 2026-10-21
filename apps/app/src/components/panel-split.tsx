import {
	DropPreview,
	type Placement,
	SplitView,
	useNativeDrag,
	useNativeDropTarget,
} from "@repo/components";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@repo/ui";
import type { ReactNode } from "react";
import { useChatSession } from "../lib/chat.tsx";
import {
	PANEL_DRAG,
	type PanelContent,
	readPanelDrag,
} from "../lib/panel-ops.ts";
import { hasTabs, usePanels } from "../lib/panels.tsx";
import { toUiNode } from "../lib/ui-node.ts";
import { GenerativeUI } from "./generative-ui.tsx";
import { FilePreview } from "./stored-file.tsx";

function tabLabel(content: PanelContent): string {
	return content.kind === "file" ? content.name : content.title;
}

function PanelTab({ content }: { content: PanelContent }) {
	const workspaceId = useChatSession((state) => state.workspaceId);
	if (content.kind === "file")
		return (
			<FilePreview
				workspaceId={workspaceId}
				folder={content.folder}
				name={content.name}
			/>
		);
	const node = toUiNode(content.node);
	if (node === undefined)
		return <div className="p-3 text-dim">this view cannot be drawn</div>;
	return (
		<div className="p-3">
			<GenerativeUI key={JSON.stringify(node)} node={node} />
		</div>
	);
}

const EXTERNAL = { type: PANEL_DRAG, read: readPanelDrag };

function ChatDropZone({
	placement,
	hit,
	lands,
	label,
}: {
	placement: Placement;
	hit: string;
	lands: string;
	label: string;
}) {
	const { place } = usePanels();
	const target = useNativeDropTarget(PANEL_DRAG, (data) => {
		const tab = readPanelDrag(data);
		if (tab) place(tab, placement);
	});
	return (
		<>
			<div {...target.handlers} className={`absolute z-20 ${hit}`} />
			{target.over && (
				<>
					<DropPreview className={lands} />
					<div
						className={`pointer-events-none absolute z-20 flex items-center justify-center text-accent ${lands}`}
					>
						{label}
					</div>
				</>
			)}
		</>
	);
}

function ChatDropZones({ open }: { open: boolean }) {
	const dragging = useNativeDrag(PANEL_DRAG);
	if (!dragging) return null;
	return (
		<>
			<ChatDropZone
				placement="focused"
				hit="inset-y-0 right-0 w-2/5"
				lands="inset-y-0 right-0 w-1/2"
				label={open ? "add as a tab in the panel" : "open beside the chat"}
			/>
			<ChatDropZone
				placement="down"
				hit="bottom-0 left-0 h-1/4 w-3/5"
				lands="inset-x-0 bottom-0 h-1/2"
				label={open ? "open in a split below" : "open beside the chat"}
			/>
		</>
	);
}

export function PanelSplit({ children }: { children: ReactNode }) {
	const { layout, change } = usePanels();
	const open = hasTabs(layout);
	return (
		<ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
			<ResizablePanel id="chat" minSize="25%">
				<div className="relative flex h-full min-h-0 min-w-0 flex-col">
					{children}
					<ChatDropZones open={open} />
				</div>
			</ResizablePanel>
			{open && (
				<>
					<ResizableHandle />
					<ResizablePanel id="panel" defaultSize="50%" minSize="20%">
						<SplitView
							layout={layout}
							onChange={change}
							renderTab={(content) => <PanelTab content={content} />}
							tabLabel={tabLabel}
							external={EXTERNAL}
						/>
					</ResizablePanel>
				</>
			)}
		</ResizablePanelGroup>
	);
}
