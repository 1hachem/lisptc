import { Sidebar, useSidebar } from "@repo/ui";
import {
	type ChatMessage,
	isGreetingMessage,
	isToolMessage,
	isUserMessage,
	messageText,
	toolModelOutput,
	useChatSession,
} from "../lib/chat.tsx";
import { useUI } from "../lib/ui.tsx";

function ModelTurn({ message }: { message: ChatMessage }) {
	if (isToolMessage(message)) {
		const { output, error } = toolModelOutput(message);
		if (!output.trim()) return null;
		return (
			<pre
				className={`whitespace-pre-wrap break-words ${error ? "text-red" : "text-dim"}`}
			>
				{output}
			</pre>
		);
	}
	const text = messageText(message);
	if (!text.trim()) return null;
	return (
		<pre
			className={`whitespace-pre-wrap break-words ${isUserMessage(message) ? "text-fg" : "text-accent"}`}
		>
			{text}
		</pre>
	);
}

function ModelView() {
	const { messages } = useChatSession();
	const turns = messages.filter((m) => !isGreetingMessage(m));
	if (turns.length === 0)
		return (
			<div className="px-4 text-[11.5px] text-dim">
				nothing has reached the model yet
			</div>
		);
	return (
		<div className="flex min-w-0 flex-col gap-3 overflow-y-auto px-4 text-[11.5px]">
			{turns.map((message) => (
				<ModelTurn key={message.id} message={message} />
			))}
		</div>
	);
}

export function RightSidebar() {
	const { state, toggleSidebar } = useSidebar();
	const { debug } = useUI();
	const collapsed = state === "collapsed";

	return (
		<Sidebar side="right" collapsible="icon" className="border-l-0!">
			{collapsed ? (
				<div className="flex h-full flex-col items-center py-3.5">
					<button
						type="button"
						onClick={toggleSidebar}
						title="expand panel"
						className="text-dim hover:text-fg"
					>
						«
					</button>
				</div>
			) : (
				<div className="flex h-full min-h-0 flex-col gap-5 py-3.5">
					<div className="flex items-baseline gap-2 px-4">
						<span className="flex-1 text-[11px] uppercase tracking-[0.14em] text-dim">
							{debug ? "what the model reads" : "panel"}
						</span>
						<button
							type="button"
							onClick={toggleSidebar}
							title="collapse panel"
							className="flex-none text-dim hover:text-fg"
						>
							»
						</button>
					</div>
					{debug ? (
						<ModelView />
					) : (
						<div className="px-4 text-[11.5px] text-dim">nothing here yet</div>
					)}
				</div>
			)}
		</Sidebar>
	);
}
