import { cn } from "@repo/ui/lib/utils";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Role, Score, Tone } from "@/lib/reports.ts";

const TONE: Record<Tone, string> = {
	green: "border-green/40 bg-green/10 text-green",
	yellow: "border-yellow/40 bg-yellow/10 text-yellow",
	red: "border-red/40 bg-red/10 text-red",
};

const ROLE_TONE: Record<Role, { label: string; tone: string }> = {
	assistant: { label: "agent", tone: "text-blue" },
	tool: { label: "repl", tone: "text-purple" },
	user: { label: "user", tone: "text-dim" },
};

export function Shell({ children }: { children: ReactNode }) {
	return (
		<main className="mx-auto w-full max-w-[1100px] px-6 pt-7 pb-16">
			{children}
		</main>
	);
}

export function Masthead({ children }: { children: ReactNode }) {
	return (
		<header className="mb-5 flex flex-wrap items-baseline justify-between gap-4 border-b border-bg2 pb-3.5">
			{children}
		</header>
	);
}

export function Title({ children }: { children: ReactNode }) {
	return <h1 className="m-0 text-[15px] text-orange">{children}</h1>;
}

export function Pill({
	tone,
	muted,
	children,
}: {
	tone: Tone;
	muted?: boolean;
	children: ReactNode;
}) {
	return (
		<span
			className={cn(
				"border px-2 py-px text-[11.5px]",
				muted ? "border-bg2 text-dim" : TONE[tone],
			)}
		>
			{children}
		</span>
	);
}

export function ScorePill({ score }: { score: Score }) {
	return (
		<Pill muted={score.total === 0} tone={score.tone}>
			{score.passed}/{score.total} checks
		</Pill>
	);
}

export function Tags({ children }: { children: ReactNode }) {
	return <div className="mt-2 flex flex-wrap gap-1.5">{children}</div>;
}

export function Tag({ children }: { children: ReactNode }) {
	return (
		<span className="bg-bg2 px-2 py-px text-[11.5px] text-dim">{children}</span>
	);
}

export function Chip({
	href,
	active,
	children,
}: {
	href: string;
	active: boolean;
	children: ReactNode;
}) {
	return (
		<Link
			className={cn(
				"border px-2 py-px text-[11.5px] transition-colors",
				active
					? "border-orange/50 bg-orange/10 text-orange"
					: "border-bg2 text-dim hover:border-dim/50 hover:text-fg",
			)}
			href={href}
		>
			{children}
		</Link>
	);
}

export function ChipRow({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-baseline gap-1.5">
			<span className="w-[46px] shrink-0 text-[11px] text-dim uppercase tracking-[0.14em]">
				{label}
			</span>
			{children}
		</div>
	);
}

export function Panel({
	className,
	children,
}: {
	className?: string;
	children: ReactNode;
}) {
	return (
		<div className={cn("border border-bg2 bg-bg1", className)}>{children}</div>
	);
}

export function Label({ children }: { children: ReactNode }) {
	return (
		<h3 className="mt-4 mb-1.5 text-[11px] text-dim uppercase tracking-[0.14em]">
			{children}
		</h3>
	);
}

export function Summary({ children }: { children: ReactNode }) {
	return (
		<summary className="cursor-pointer select-none px-4 py-2.5 text-[12px] text-dim hover:text-fg">
			{children}
		</summary>
	);
}

export function Turn({
	role,
	className,
	children,
}: {
	role: Role;
	className?: string;
	children: string;
}) {
	const who = ROLE_TONE[role];
	return (
		<div
			className={cn(
				"grid grid-cols-[54px_1fr] items-baseline gap-3 px-4 py-1.5",
				className,
			)}
		>
			<span className={cn("text-[11px] uppercase tracking-[0.14em]", who.tone)}>
				{who.label}
			</span>
			<pre
				className={cn(
					"m-0 whitespace-pre-wrap break-words font-mono text-[12.5px]",
					role === "tool" && "text-dim",
				)}
			>
				{children}
			</pre>
		</div>
	);
}
