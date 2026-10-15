import { useChatSession } from "../lib/chat.tsx";
import { useCommandRunner } from "../lib/commands.ts";
import { AgentAvatar } from "./agent-avatar.tsx";
import { ChatInput } from "./chat-input.tsx";
import { ChatView } from "./chat-view.tsx";
import { Greeting } from "./greeting.tsx";

export function Chat() {
	const runCommand = useCommandRunner();
	const { send, runLisp, stop, isLoading, fresh } = useChatSession((state) => ({
		send: state.send,
		runLisp: state.runLisp,
		stop: state.stop,
		isLoading: state.isLoading,
		fresh: state.fresh,
	}));

	return (
		<>
			{fresh ? null : <ChatView />}
			<div
				className={
					fresh
						? "flex min-h-0 flex-1 flex-col justify-center px-8 pb-7"
						: "px-8 pb-7"
				}
			>
				<div
					className={
						fresh
							? "mx-auto mb-5 flex w-full max-w-[680px] items-center justify-center gap-2.5"
							: "hidden"
					}
				>
					{fresh ? (
						<>
							<AgentAvatar />
							<Greeting />
						</>
					) : null}
				</div>
				<ChatInput
					placeholder="type a message  ·  / for commands  ·  ! for lisp"
					onSubmit={send}
					onLisp={runLisp}
					onCommand={runCommand}
					isStreaming={isLoading}
					onStop={stop}
				/>
			</div>
		</>
	);
}
