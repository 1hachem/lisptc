import {
	cn,
	PromptInput,
	PromptInputSubmit,
	PromptInputTextarea,
} from "@repo/ui";
import { useState } from "react";
import { commands } from "../lib/commands.ts";

export interface ChatInputProps {
	placeholder?: string;
	onSubmit: (text: string) => void;
	/** run when a `/` command is picked */
	onCommand?: (name: string) => void;
}

export function ChatInput({
	placeholder = "",
	onSubmit,
	onCommand,
}: ChatInputProps) {
	const [value, setValue] = useState("");

	const slash = value.startsWith("/") && !value.includes(" ");
	const matches = slash
		? commands.filter((c) =>
				c.name.slice(1).startsWith(value.slice(1).toLowerCase()),
			)
		: [];

	function submit(text: string) {
		const t = text.trim();
		if (!t) return;
		if (t.startsWith("/")) {
			onCommand?.(t.split(" ")[0]);
			setValue("");
			return;
		}
		onSubmit(t);
		setValue("");
	}

	return (
		<div className="mx-auto flex w-full max-w-[680px] flex-col font-mono text-[13px] leading-[1.7]">
			{matches.length > 0 && (
				<div className="flex flex-col gap-px border-b border-bg2 bg-bg1 py-1">
					{matches.map((c) => (
						<button
							type="button"
							key={c.name}
							onClick={() => submit(c.name)}
							className="flex items-baseline gap-2.5 px-3 py-0.5 text-left hover:brightness-125"
						>
							<span className="flex-none whitespace-nowrap text-fg">
								{c.name}
							</span>
							<span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-dim">
								{c.desc}
							</span>
							{c.hint && (
								<span className="flex-none text-[10.5px] text-dim">
									{c.hint}
								</span>
							)}
						</button>
					))}
				</div>
			)}

			<PromptInput
				onSubmit={(message) => submit(message.text ?? value)}
				className="border-0 bg-transparent shadow-none"
			>
				<div className="flex items-end gap-2.5 border-b border-bg2 bg-bg1 px-3 py-1">
					<span className="flex-none self-start py-1 text-green">›</span>
					<PromptInputTextarea
						value={value}
						onChange={(e) => setValue(e.target.value)}
						placeholder={placeholder}
						rows={1}
						className="max-h-40 min-h-0 resize-none border-0 bg-transparent px-0 py-1 font-mono text-[13px] text-yellow caret-yellow shadow-none focus-visible:ring-0 dark:bg-transparent"
					/>
					<PromptInputSubmit
						status={undefined}
						className={cn(
							"h-auto flex-none gap-[7px] self-end rounded-none bg-bg2 px-[9px] py-px text-[11.5px] text-green hover:brightness-125",
						)}
					>
						<span>send</span>
						<span className="text-dim">⏎</span>
					</PromptInputSubmit>
				</div>
			</PromptInput>
		</div>
	);
}
