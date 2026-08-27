import { createFileRoute } from "@tanstack/react-router";
import { ChatInput } from "../components/chat-input.tsx";
import { ChatView } from "../components/chat-view.tsx";
import { useChatSession } from "../lib/chat.tsx";
import { useCommandRunner } from "../lib/commands.ts";

export const Route = createFileRoute("/")({
	component: ChatRoute,
});

function ChatRoute() {
	const runCommand = useCommandRunner();
	const { send, stop, isLoading } = useChatSession();

	return (
		<>
			<ChatView />
			<div className="px-8 pb-7">
				<ChatInput
					placeholder="type a message  ·  / for commands"
					onSubmit={send}
					onCommand={runCommand}
					isStreaming={isLoading}
					onStop={stop}
				/>
			</div>
		</>
	);
}
