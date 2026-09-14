import { useEffect, useRef, useState } from "react";
import { useLisptc } from "../lib/lisptc.ts";
import { InputAction, InputShell } from "./input-shell.tsx";
import { LispText } from "./lisp-text.tsx";

export interface LispEditorProps {
	initial: string;
	onRun: (code: string) => void;
	onExit: () => void;
	isStreaming?: boolean;
	onStop?: () => void;
}

export function LispEditor({
	initial,
	onRun,
	onExit,
	isStreaming,
	onStop,
}: LispEditorProps) {
	const [text, setText] = useState(initial);
	const area = useRef<HTMLTextAreaElement>(null);
	const mirror = useRef<HTMLPreElement>(null);
	const lisptc = useLisptc();

	useEffect(() => {
		area.current?.focus();
	}, []);

	const run = () => {
		const code = text.trim();
		if (!code || isStreaming) return;
		onRun(code);
		setText("");
	};

	const waiting = (lisptc?.read(text).openForms ?? 0) > 0;

	return (
		<InputShell
			prompt="!"
			tone="text-aqua"
			action={
				isStreaming ? (
					<InputAction
						label="stop"
						glyph="■"
						tone="text-red hover:brightness-125"
						onClick={onStop}
					/>
				) : (
					<InputAction
						label="run"
						glyph="⏎"
						tone="text-aqua hover:brightness-125"
						onClick={run}
					/>
				)
			}
		>
			<pre
				ref={mirror}
				aria-hidden
				className="pointer-events-none max-h-80 overflow-hidden whitespace-pre-wrap break-words px-0 py-1 font-[inherit] text-[length:inherit]"
			>
				<LispText>{text}</LispText>
				{"\n"}
			</pre>
			{text === "" && (
				<div className="pointer-events-none absolute inset-0 truncate py-1 text-dim">
					(+ 1 2) · esc to leave
				</div>
			)}
			<textarea
				ref={area}
				value={text}
				spellCheck={false}
				onChange={(event) => setText(event.target.value)}
				onScroll={() => {
					if (mirror.current && area.current)
						mirror.current.scrollTop = area.current.scrollTop;
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape" || (event.key === "Backspace" && !text)) {
						event.preventDefault();
						onExit();
						return;
					}
					if (event.key !== "Enter" || event.shiftKey) return;
					if (isStreaming) {
						event.preventDefault();
						onStop?.();
						return;
					}
					if (waiting && !(event.metaKey || event.ctrlKey)) return;
					event.preventDefault();
					run();
				}}
				className="absolute inset-0 resize-none overflow-y-auto border-0 bg-transparent px-0 py-1 text-transparent caret-yellow outline-none"
			/>
		</InputShell>
	);
}
