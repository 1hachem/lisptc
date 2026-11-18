import { cn } from "@repo/ui";
import type { AnchorMark } from "@repo/ui-catalog";
import type { ReactNode } from "react";

export function InputShell({
	prompt,
	tone,
	dim,
	action,
	children,
}: {
	prompt: string;
	tone: string;
	dim?: boolean;
	action: ReactNode;
	children: ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex w-full items-end gap-2.5 border-b border-bg2 bg-bg1 px-3 py-1",
				dim && "opacity-60",
			)}
		>
			<span className={cn("flex-none self-start py-1", tone)}>{prompt}</span>
			<div className="relative min-w-0 flex-1">{children}</div>
			{action}
		</div>
	);
}

export function InputAction({
	label,
	glyph,
	tone,
	onClick,
	disabled,
	title,
	anchor,
}: {
	label: string;
	glyph: string;
	tone: string;
	onClick?: () => void;
	disabled?: boolean;
	title?: string;
	anchor?: AnchorMark;
}) {
	return (
		<button
			{...anchor}
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={title}
			className={cn(
				"flex h-auto flex-none items-center gap-[7px] self-center rounded-none bg-bg2 px-[9px] py-px text-[11.5px]",
				disabled ? "cursor-not-allowed text-dim" : tone,
			)}
		>
			<span>{label}</span>
			<span className="text-dim">{glyph}</span>
		</button>
	);
}
