"use client";

import {
	Add01Icon,
	CommandLineIcon,
	File01Icon,
	Folder01Icon,
	Folder02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { ReactNode } from "react";

const INDENT_REM = 0.875;

function indent(depth: number) {
	return { paddingLeft: `${0.625 + depth * INDENT_REM}rem` };
}

export function TreeFolder({
	name,
	icon,
	open,
	onToggle,
	onCreate,
	createLabel,
	depth = 0,
	children,
}: {
	name: string;
	icon?: IconSvgElement;
	open: boolean;
	onToggle: () => void;
	onCreate?: (() => void) | "disabled";
	createLabel?: string;
	depth?: number;
	children?: ReactNode;
}) {
	return (
		<div data-open={open}>
			<div className="group/folder flex items-center">
				<button
					type="button"
					onClick={onToggle}
					style={indent(depth)}
					className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 pr-1 text-left text-blue hover:brightness-125"
				>
					<HugeiconsIcon
						className="size-icon-sm flex-none"
						icon={icon ?? (open ? Folder02Icon : Folder01Icon)}
					/>
					<span className="truncate">{name}/</span>
				</button>
				{onCreate && (
					<button
						type="button"
						title={createLabel ?? `new in ${name}/`}
						disabled={onCreate === "disabled"}
						onClick={onCreate === "disabled" ? undefined : onCreate}
						className="flex-none cursor-pointer px-1.5 py-1 text-dim hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-dim"
					>
						<HugeiconsIcon className="size-icon-sm" icon={Add01Icon} />
					</button>
				)}
			</div>
			{open && <div>{children}</div>}
		</div>
	);
}

export function TreeFile({
	name,
	selected,
	depth = 0,
	link,
	trailing,
}: {
	name: string;
	selected: boolean;
	depth?: number;
	link: (content: ReactNode, className: string) => ReactNode;
	trailing?: ReactNode;
}) {
	return (
		<div
			data-selected={selected}
			className={`group/row flex items-center ${selected ? "bg-bg2" : ""}`}
		>
			<div style={indent(depth)} className="flex min-w-0 flex-1">
				{link(
					<>
						<HugeiconsIcon
							className="size-icon-sm flex-none"
							icon={File01Icon}
						/>
						<span className="truncate">{name}</span>
					</>,
					`flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 ${
						selected ? "text-fg" : "text-dim hover:text-fg"
					}`,
				)}
			</div>
			{trailing}
		</div>
	);
}

export function TreeCommand({
	name,
	onRun,
	depth = 0,
}: {
	name: string;
	onRun: () => void;
	depth?: number;
}) {
	return (
		<button
			type="button"
			onClick={onRun}
			title={`run ${name}`}
			style={indent(depth)}
			className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 py-1 pr-1 text-left text-green hover:brightness-125"
		>
			<HugeiconsIcon
				className="size-icon-sm flex-none"
				icon={CommandLineIcon}
			/>
			<span className="truncate">{name}</span>
		</button>
	);
}

export function TreeFilter({
	value,
	onChange,
	label,
	depth = 1,
}: {
	value: string;
	onChange: (value: string) => void;
	label: string;
	depth?: number;
}) {
	return (
		<input
			type="search"
			value={value}
			onChange={(event) => onChange(event.target.value)}
			placeholder={label}
			aria-label={label}
			style={indent(depth)}
			className="w-full bg-transparent py-1 pr-1 text-fg outline-none placeholder:text-dim"
		/>
	);
}

export function TreeMore({
	onMore,
	depth = 1,
}: {
	onMore: () => void;
	depth?: number;
}) {
	return (
		<button
			type="button"
			onClick={onMore}
			style={indent(depth)}
			className="w-full cursor-pointer py-1 pr-1 text-left text-dim hover:text-fg"
		>
			more…
		</button>
	);
}

export function FileTree({ children }: { children: ReactNode }) {
	return <div className="font-mono">{children}</div>;
}
