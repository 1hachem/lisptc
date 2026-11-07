import type { Id } from "@repo/backend/dataModel";
import {
	type ChatMessage,
	isToolMessage,
	Trace,
	type TraceChild,
	type TraceSlots,
	TraceSteps,
} from "@repo/components";
import { attachedTo } from "../lib/attached-files.ts";
import { useTrace } from "../lib/trace-source.tsx";
import { AttachedFiles } from "./attached-files.tsx";
import { ChatLine, ToolMessage } from "./chat-view.tsx";
import { MessageMeta } from "./message-meta.tsx";

function NestedTrace({ chatId }: { chatId: string }) {
	return <TraceSteps messages={useTrace(chatId as Id<"chats">)} />;
}

function ChildTrace({ child }: { child: TraceChild }) {
	return (
		<div
			data-child-trace={child.chatId}
			className="flex min-w-0 flex-col gap-2 border-dim/20 border-l pl-3"
		>
			<div className="flex min-w-0 gap-2 text-[11.5px] text-dim">
				<span className="flex-none">agent</span>
				<span className="min-w-0 truncate text-fg">{child.label}</span>
			</div>
			<NestedTrace chatId={child.chatId} />
		</div>
	);
}

const APP_SLOTS: TraceSlots = {
	line: (message) =>
		isToolMessage(message) ? (
			<ToolMessage message={message} />
		) : (
			<ChatLine message={message} />
		),
	meta: (meta) => (
		<MessageMeta
			meta={meta}
			show={{ steps: false, model: false, provider: false }}
		/>
	),
	attachments: (message) => {
		const files = attachedTo(message);
		return files.length === 0 ? null : <AttachedFiles files={files} />;
	},
	child: (child) => <ChildTrace child={child} />,
};

export function TraceLines({
	messages,
	turn,
}: {
	messages: readonly ChatMessage[];
	turn?: string;
}) {
	return <Trace messages={messages} turn={turn} slots={APP_SLOTS} />;
}

export function TraceView({ chatId, turn }: { chatId: string; turn?: string }) {
	return <TraceLines messages={useTrace(chatId as Id<"chats">)} turn={turn} />;
}
