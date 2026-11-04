import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@repo/ui";
import { anchorOf } from "@repo/ui-catalog";
import type { ReactNode } from "react";
import { CHAT_MIN_WIDTH, SIDE_TRACE_MIN_WIDTH } from "../lib/panel-ops.ts";
import { Chat } from "./chat.tsx";

export function ChatSurface({
	toggle,
	trace,
}: {
	toggle: ReactNode;
	trace: ReactNode;
}) {
	return (
		<ResizablePanelGroup orientation="horizontal">
			<ResizablePanel id="chat" minSize={CHAT_MIN_WIDTH}>
				<div className="relative flex h-full min-h-0 min-w-0 flex-col">
					{toggle}
					<Chat />
				</div>
			</ResizablePanel>
			{trace && (
				<>
					<ResizableHandle {...anchorOf("chat/trace-resize")} />
					<ResizablePanel
						id="trace"
						defaultSize="40%"
						minSize={SIDE_TRACE_MIN_WIDTH}
					>
						<div data-side-trace className="h-full min-h-0 min-w-0">
							{trace}
						</div>
					</ResizablePanel>
				</>
			)}
		</ResizablePanelGroup>
	);
}
