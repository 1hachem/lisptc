import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
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
	const [audioError, setAudioError] = useState<string | null>(null);

	const sendText = useCallback(
		(text: string) => {
			setAudioError(null);
			send(text);
		},
		[send],
	);

	return (
		<>
			<ChatView />
			<div className="px-8 pb-7">
				{audioError && (
					<div className="mx-auto w-full max-w-[680px] px-3 pb-1 font-mono text-[12px] text-red">
						mic: {audioError}
					</div>
				)}
				<ChatInput
					placeholder={
						warming
							? "warming up  ·  caching the system prompt, this can take a few minutes"
							: "type a message  ·  / for commands"
					}
					onSubmit={sendText}
					onCommand={runCommand}
					isStreaming={isLoading}
					onStop={stop}
					disabled={warming}
					onAudioError={setAudioError}
				/>
			</div>
		</>
	);
}
