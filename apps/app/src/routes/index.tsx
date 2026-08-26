import { createFileRoute } from "@tanstack/react-router";
import { ChatInput } from "../components/chat-input.tsx";
import { ChatView } from "../components/chat-view.tsx";
import { sendMessage } from "../lib/chat.ts";
import { useCommandRunner } from "../lib/commands.ts";

export const Route = createFileRoute("/")({
	component: ChatRoute,
});

function ChatRoute() {
	const runCommand = useCommandRunner();

	return (
		<>
			<ChatView />
			<div className="px-8 pb-7">
				<ChatInput
					placeholder="type a message  ·  / for commands"
					onSubmit={sendMessage}
					onCommand={runCommand}
				/>
			</div>
		</>
	);
}
