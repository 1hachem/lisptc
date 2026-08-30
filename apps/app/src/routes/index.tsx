import { createFileRoute } from "@tanstack/react-router";
import { ChatInput } from "../components/chat-input.tsx";
import { ChatView } from "../components/chat-view.tsx";
import { useChatSession, useWarmup } from "../lib/chat.tsx";
import { useCommandRunner } from "../lib/commands.ts";

export const Route = createFileRoute("/")({
	component: ChatRoute,
});

function ChatRoute() {
	const runCommand = useCommandRunner();
	const { send, stop, isLoading } = useChatSession();
	const { warming } = useWarmup();

	return (
		<>
			<ChatView />
			<div className="px-8 pb-7">
				<ChatInput
					placeholder={
						warming
							? "warming up  ·  caching the system prompt, this can take a few minutes"
							: "type a message  ·  / for commands"
					}
					onSubmit={send}
					onCommand={runCommand}
					isStreaming={isLoading}
					onStop={stop}
					disabled={warming}
				/>
			</div>
		</>
	);
}
