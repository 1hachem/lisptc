"use client";

import {
	Add01Icon,
	CommandLineIcon,
	File01Icon,
	Folder01Icon,
	Folder02Icon,
	Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { ReactNode } from "react";
import { useEntryDragged } from "./sortable-tree.tsx";

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
	const dragged = useEntryDragged();
	const shown = open && !dragged;
	return (
		<div data-open={shown}>
			<div className="group/folder flex items-center">
				<button
					type="button"
					onClick={onToggle}
					style={indent(depth)}
					className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 pr-1 text-left text-blue hover:brightness-125"
				>
					<HugeiconsIcon
						className="size-icon-sm flex-none"
						icon={icon ?? (shown ? Folder02Icon : Folder01Icon)}
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
			{shown && <div>{children}</div>}
		</div>
	);
}

export function TreeFile({
	name,
	icon,
	iconClassName = "",
	glyph,
	iconLabel,
	selected,
	depth = 0,
	link,
	trailing,
}: {
	name: string;
	icon?: IconSvgElement;
	iconClassName?: string;
	glyph?: ReactNode;
	iconLabel?: string;
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
						<span title={iconLabel} className="flex flex-none">
							{glyph ?? (
								<HugeiconsIcon
									className={`size-icon-sm ${iconClassName}`}
									icon={icon ?? File01Icon}
								/>
							)}
							{iconLabel && <span className="sr-only">{iconLabel}</span>}
						</span>
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

export function TreePending({
	name,
	label,
	depth = 0,
}: {
	name: string;
	label: string;
	depth?: number;
}) {
	return (
		<div
			role="status"
			aria-label={`${label} ${name}`}
			title={`${label} ${name}`}
			style={indent(depth)}
			className="flex min-w-0 items-center gap-1.5 py-1 pr-1 text-dim"
		>
			<HugeiconsIcon
				className="size-icon-sm flex-none animate-spin"
				icon={Loading03Icon}
			/>
			<span className="min-w-0 truncate whitespace-nowrap">{name}</span>
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
