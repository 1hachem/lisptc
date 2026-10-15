import { convexQuery } from "@convex-dev/react-query";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useChatSession } from "../lib/chat.tsx";
import { useCommandRunner } from "../lib/commands.ts";
import { sentHistory } from "../lib/message-history.ts";
import { useModelPicker } from "../lib/model-picker.tsx";
import { AgentAvatar } from "./agent-avatar.tsx";
import { ChatInput } from "./chat-input.tsx";
import { ChatView } from "./chat-view.tsx";
import { Greeting } from "./greeting.tsx";
import { McpServers } from "./mcp-servers.tsx";

export function Chat() {
	const runCommand = useCommandRunner();
	const { modelName, providerName, openModelPicker } = useModelPicker();
	const { workspaceId, send, runLisp, stop, isLoading, fresh } = useChatSession(
		(state) => ({
			workspaceId: state.workspaceId,
			send: state.send,
			runLisp: state.runLisp,
			stop: state.stop,
			isLoading: state.isLoading,
			fresh: state.fresh,
		}),
	);
	const { data: sent } = useQuery(
		convexQuery(api.messages.sent, { workspaceId }),
	);
	const history = useMemo(() => sentHistory(sent ?? []), [sent]);

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
				<McpServers />
				<ChatInput
					placeholder="type a message  ·  / for commands  ·  ! for lisp"
					onSubmit={send}
					history={history}
					onLisp={runLisp}
					onCommand={runCommand}
					isStreaming={isLoading}
					onStop={stop}
				/>
				<div className="mx-auto mt-1 flex w-full max-w-[680px] justify-end px-3 text-[11px]">
					<button
						type="button"
						onClick={openModelPicker}
						title="change the model for this workspace"
						className="flex cursor-pointer items-center gap-1 text-dim hover:text-fg"
					>
						<span>
							{modelName} · {providerName}
						</span>
						<HugeiconsIcon className="size-icon-sm" icon={ArrowDown01Icon} />
					</button>
				</div>
			</div>
		</>
	);
}
