import type { ReactNode } from "react";
import { useChatSession } from "../lib/chat.tsx";
import { useCommandRunner } from "../lib/commands.ts";
import type { OpenFile } from "../lib/files.ts";
import { ChatInput } from "./chat-input.tsx";
import { LispSource } from "./lisp-text.tsx";

export function FileView({
	file,
	missing,
	actions,
	body,
}: {
	file: OpenFile | undefined;
	missing?: string;
	actions?: ReactNode;
	body?: ReactNode;
}) {
	const runCommand = useCommandRunner();
	const { sendAbout, runLisp, stop, isLoading } = useChatSession((state) => ({
		sendAbout: state.sendAbout,
		runLisp: state.runLisp,
		stop: state.stop,
		isLoading: state.isLoading,
	}));

	return (
		<>
			<div className="min-h-0 flex-1 overflow-y-auto px-8 pt-6">
				<div className="mx-auto flex w-full max-w-[680px] flex-col gap-3">
					<div className="flex items-baseline gap-3 font-mono text-[11.5px] text-dim">
						<span className="min-w-0 flex-1 truncate">{file?.path ?? ""}</span>
						{actions}
					</div>
					{file === undefined ? (
						<div className="text-dim">{missing ?? "loading…"}</div>
					) : body !== undefined ? (
						body
					) : file.source.trim() === "" ? (
						<div className="text-dim">empty</div>
					) : (
						<pre className="whitespace-pre-wrap break-words font-mono">
							<LispSource>{file.source}</LispSource>
						</pre>
					)}
				</div>
			</div>
			<div className="px-8 pb-7">
				<ChatInput
					placeholder={
						file
							? `ask about ${file.path}  ·  / for commands  ·  ! for lisp`
							: "type a message  ·  / for commands  ·  ! for lisp"
					}
					onSubmit={(text) => {
						if (file) sendAbout(file, text);
					}}
					onLisp={runLisp}
					onCommand={runCommand}
					isStreaming={isLoading}
					onStop={stop}
				/>
			</div>
		</>
	);
}
