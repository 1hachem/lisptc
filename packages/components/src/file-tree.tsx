"use client";

import {
	Add01Icon,
	CheckmarkSquare02Icon,
	CommandLineIcon,
	File01Icon,
	Folder01Icon,
	Folder02Icon,
	Loading03Icon,
	SquareIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
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

type TreeCheck = {
	checked: boolean;
	selecting: boolean;
	onCheck: (range: boolean) => void;
};

function CheckBox({
	name,
	check,
	glyph,
}: {
	name: string;
	check: TreeCheck;
	glyph: ReactNode;
}) {
	const box = (
		<HugeiconsIcon
			className="size-icon-sm"
			icon={check.checked ? CheckmarkSquare02Icon : SquareIcon}
		/>
	);
	return (
		<label
			className={`relative flex flex-none cursor-pointer items-center py-1 pr-1.5 has-[:focus-visible]:text-fg ${
				check.checked ? "text-fg" : "text-dim hover:text-fg"
			}`}
		>
			<input
				type="checkbox"
				checked={check.checked}
				aria-label={`select ${name}`}
				onChange={(event) =>
					check.onCheck(
						event.nativeEvent instanceof MouseEvent &&
							event.nativeEvent.shiftKey,
					)
				}
				className="sr-only"
			/>
			{check.checked || check.selecting ? (
				box
			) : (
				<>
					<span className="flex group-hover/row:hidden">{glyph}</span>
					<span className="hidden group-hover/row:flex">{box}</span>
				</>
			)}
		</label>
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
	check,
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
	check?: TreeCheck;
}) {
	const mark = (
		<span title={iconLabel} className="flex flex-none">
			{glyph ?? (
				<HugeiconsIcon
					className={`size-icon-sm ${iconClassName}`}
					icon={icon ?? File01Icon}
				/>
			)}
			{iconLabel && <span className="sr-only">{iconLabel}</span>}
		</span>
	);
	return (
		<div
			data-selected={selected}
			data-checked={check?.checked}
			className={`group/row flex items-center ${
				selected || check?.checked ? "bg-bg2" : ""
			}`}
		>
			<div style={indent(depth)} className="flex min-w-0 flex-1">
				{check && <CheckBox name={name} check={check} glyph={mark} />}
				{link(
					<>
						{!check && mark}
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

export function TreeAction({
	label,
	confirm,
	onRun,
	danger = false,
}: {
	label: string;
	confirm?: string;
	onRun: () => void;
	danger?: boolean;
}) {
	const [armed, setArmed] = useState(false);
	return (
		<button
			type="button"
			onClick={() => {
				if (confirm && !armed) {
					setArmed(true);
					return;
				}
				setArmed(false);
				onRun();
			}}
			onBlur={() => setArmed(false)}
			className={`cursor-pointer ${
				danger ? "hover:text-red" : "hover:text-fg"
			} ${armed ? "text-red" : "text-dim"}`}
		>
			{armed ? confirm : label}
		</button>
	);
}

const SELECTIONS_HOST = "tree-selections";

function selectionsHost(): HTMLElement {
	const found = document.getElementById(SELECTIONS_HOST);
	if (found !== null) return found;
	const host = document.createElement("div");
	host.id = SELECTIONS_HOST;
	host.className =
		"pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4";
	document.body.append(host);
	return host;
}

export function TreeSelection({
	count,
	total,
	where,
	onAll,
	onClear,
	failure,
	busy = false,
	children,
}: {
	count: number;
	total: number;
	where: string;
	onAll: () => void;
	onClear: () => void;
	failure?: string | null;
	busy?: boolean;
	children: ReactNode;
}) {
	const [host, setHost] = useState<HTMLElement | null>(null);
	useEffect(() => setHost(selectionsHost()), []);
	if (host === null) return null;
	const picked = `${count} ${count === 1 ? "file" : "files"} selected`;

	return createPortal(
		<div
			role="toolbar"
			aria-label={`${picked} in ${where}`}
			className="pointer-events-auto flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 border border-bg2 bg-bg1 px-3 py-1.5 font-mono text-[11.5px] text-dim shadow-lg"
		>
			<span className="text-fg">
				{picked} in <span className="text-blue">{where}</span>
			</span>
			{count < total && <TreeAction label="all" onRun={onAll} />}
			<TreeAction label="clear" onRun={onClear} />
			<span aria-hidden className="text-bg2">
				|
			</span>
			{busy ? (
				<HugeiconsIcon
					className="size-icon-sm animate-spin"
					icon={Loading03Icon}
				/>
			) : (
				children
			)}
			{failure && <div className="w-full text-red">{failure}</div>}
		</div>,
		host,
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
		<div style={indent(depth)} className="flex items-center gap-1.5 pr-1">
			<span aria-hidden className="size-icon-sm flex-none" />
			<input
				type="search"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={label}
				aria-label={label}
				className="min-w-0 flex-1 bg-transparent py-1 text-fg outline-none placeholder:text-dim"
			/>
		</div>
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
