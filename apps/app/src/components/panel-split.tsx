import { SplitView } from "@repo/components";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@repo/ui";
import type { ReactNode } from "react";
import { useChatSession } from "../lib/chat.tsx";
import type { PanelContent } from "../lib/panel-ops.ts";
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

export function PanelSplit({ children }: { children: ReactNode }) {
	const { layout, change } = usePanels();
	const open = hasTabs(layout);
	return (
		<ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
			<ResizablePanel id="chat" minSize="25%">
				<div className="flex h-full min-h-0 min-w-0 flex-col">{children}</div>
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
						/>
					</ResizablePanel>
				</>
			)}
		</ResizablePanelGroup>
	);
}
