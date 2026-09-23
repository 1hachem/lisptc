import type { ReactNode } from "react";

export type Tone = "green" | "yellow" | "red" | "blue" | "neutral";

const toneText: Record<Tone, string> = {
	green: "text-green",
	yellow: "text-yellow",
	red: "text-red",
	blue: "text-blue",
	neutral: "text-dim",
};

export function Shell({ children }: { children: ReactNode }) {
	return (
		<main className="mx-auto grid max-w-[1100px] gap-4 px-5 py-8">
			{children}
		</main>
	);
}

export function Masthead({ children }: { children: ReactNode }) {
	return (
		<header className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-2 border-bg2 border-b pb-3">
			{children}
		</header>
	);
}

export function Title({ children }: { children: ReactNode }) {
	return <h1 className="m-0 text-[18px] text-fg">{children}</h1>;
}

export function Panel({
	title,
	note,
	children,
}: {
	title: string;
	note?: string;
	children: ReactNode;
}) {
	return (
		<section className="min-w-0 border border-bg2 bg-bg1 p-4">
			<div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<h2 className="m-0 text-[13px] text-fg uppercase tracking-wide">
					{title}
				</h2>
				{note === undefined ? null : (
					<span className="text-[11.5px] text-dim">{note}</span>
				)}
			</div>
			{children}
		</section>
	);
}

export function Stat({
	label,
	value,
	note,
	tone = "neutral",
}: {
	label: string;
	value: string;
	note?: string;
	tone?: Tone;
}) {
	return (
		<div className="border border-bg2 bg-bg1 px-4 py-3">
			<div className="text-[11.5px] text-dim uppercase tracking-wide">
				{label}
			</div>
			<div className={`mt-1 text-[24px] tabular-nums ${toneText[tone]}`}>
				{value}
			</div>
			{note === undefined ? null : (
				<div className="mt-0.5 text-[11.5px] text-dim">{note}</div>
			)}
		</div>
	);
}

export function Stats({ children }: { children: ReactNode }) {
	return (
		<div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
	);
}

export function Pill({
	tone = "neutral",
	children,
}: {
	tone?: Tone;
	children: ReactNode;
}) {
	return (
		<span
			className={`border border-bg2 px-1.5 py-0.5 text-[11px] ${toneText[tone]}`}
		>
			{children}
		</span>
	);
}

export function Empty({ children }: { children: ReactNode }) {
	return (
		<p className="border border-bg2 border-dashed p-7 text-center text-dim">
			{children}
		</p>
	);
}
