import type { Question } from "@repo/interpreter/annotations";
import { Button } from "@repo/ui";
import { anchorOf } from "@repo/ui-catalog";
import { useCallback, useEffect, useRef, useState } from "react";
import { answerOf } from "../lib/question.ts";
import { InputAction, InputShell } from "./input-shell.tsx";

const PICKABLE = 9;

function typingIn(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}

function pickedBy(key: string, choices: number): number | undefined {
	const at = Number(key) - 1;
	return Number.isInteger(at) && at >= 0 && at < Math.min(choices, PICKABLE)
		? at
		: undefined;
}

function usePickerKeys(handlers: {
	pick: (at: number) => void;
	submit: () => void;
	dismiss: () => void;
	choices: number;
	multi: boolean;
}) {
	const latest = useRef(handlers);
	latest.current = handlers;
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing) return;
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			if (typingIn(event.target)) return;
			const { pick, submit, dismiss, choices, multi } = latest.current;
			const at = pickedBy(event.key, choices);
			if (at !== undefined) pick(at);
			else if (event.key === "Escape") dismiss();
			else if (event.key === "Enter" && multi) submit();
			else return;
			event.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
}

export function QuestionPicker({
	question,
	disabled,
	onAnswer,
	onDismiss,
}: {
	question: Question;
	disabled?: boolean;
	onAnswer: (text: string) => void;
	onDismiss: () => void;
}) {
	const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
	const submit = () => {
		if (disabled || checked.size === 0) return;
		onAnswer(
			answerOf(
				question,
				[...checked].sort((a, b) => a - b),
			),
		);
	};
	const pick = (at: number) => {
		if (disabled) return;
		if (!question.multi) {
			onAnswer(answerOf(question, [at]));
			return;
		}
		setChecked((current) => {
			const next = new Set(current);
			if (!next.delete(at)) next.add(at);
			return next;
		});
	};
	usePickerKeys({
		pick,
		submit,
		dismiss: onDismiss,
		choices: question.choices.length,
		multi: question.multi,
	});

	return (
		<div
			{...anchorOf("composer/question")}
			className="relative mx-auto flex w-full max-w-[680px] flex-col font-mono text-[13px] leading-[1.7]"
		>
			<InputShell
				prompt="?"
				tone="text-yellow"
				dim={disabled}
				action={
					<>
						<InputAction
							label="type instead"
							glyph="esc"
							tone="text-dim hover:text-fg"
							onClick={onDismiss}
						/>
						{question.multi && (
							<InputAction
								label="send"
								glyph="⏎"
								tone="text-green hover:brightness-125"
								onClick={submit}
								disabled={disabled || checked.size === 0}
							/>
						)}
					</>
				}
			>
				<fieldset
					aria-label={question.prompt}
					className="flex min-w-0 flex-col gap-1.5 py-1"
				>
					<legend className="whitespace-pre-wrap break-words text-fg">
						{question.prompt}
					</legend>
					<div className="flex flex-wrap gap-1.5">
						{question.choices.map((choice, at) => (
							<Button
								key={choice}
								type="button"
								size="sm"
								variant={checked.has(at) ? "secondary" : "outline"}
								aria-pressed={question.multi ? checked.has(at) : undefined}
								disabled={disabled}
								onClick={() => pick(at)}
								className="min-w-0 max-w-full shrink rounded-none font-mono"
							>
								{at < PICKABLE && <span className="text-dim">{at + 1}</span>}
								<span className="min-w-0 truncate">{choice}</span>
							</Button>
						))}
					</div>
				</fieldset>
			</InputShell>
		</div>
	);
}

export function useOpenQuestion(
	question: Question | undefined,
	streaming: boolean,
) {
	const [typing, setTyping] = useState<string | undefined>(undefined);
	const open =
		question !== undefined && !streaming && typing !== question.id
			? question
			: undefined;
	const dismiss = useCallback(() => setTyping(question?.id), [question]);
	return {
		open,
		dismiss,
		typed: question !== undefined && typing === question.id,
	};
}
