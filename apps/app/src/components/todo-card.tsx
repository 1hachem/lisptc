import { CheckmarkSquare02Icon, SquareIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type RefObject, useEffect, useState } from "react";
import type { TurnTodos } from "../lib/turn-groups.ts";
import { ProgressBar } from "./turn-intent.tsx";

const NARROW_PX = 480;

const collapsedKey = (chatId: string) => `todo-card:collapsed:${chatId}`;

function readCollapsed(chatId: string | null): boolean {
	if (chatId === null) return false;
	try {
		return localStorage.getItem(collapsedKey(chatId)) === "1";
	} catch {
		return false;
	}
}

function writeCollapsed(chatId: string | null, collapsed: boolean) {
	if (chatId === null) return;
	try {
		if (collapsed) localStorage.setItem(collapsedKey(chatId), "1");
		else localStorage.removeItem(collapsedKey(chatId));
	} catch {}
}

function useNarrow(area: RefObject<HTMLElement | null>): boolean {
	const [narrow, setNarrow] = useState(false);
	useEffect(() => {
		const element = area.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const measure = () => {
			const width = element.clientWidth;
			setNarrow(width > 0 && width < NARROW_PX);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [area]);
	return narrow;
}

export function TodoCard({
	todos,
	chatId,
	area,
}: {
	todos: TurnTodos | undefined;
	chatId: string | null;
	area: RefObject<HTMLElement | null>;
}) {
	const narrow = useNarrow(area);
	const [collapsed, setCollapsed] = useState(() => readCollapsed(chatId));
	const [opened, setOpened] = useState(false);
	useEffect(() => {
		setCollapsed(readCollapsed(chatId));
		setOpened(false);
	}, [chatId]);
	if (todos === undefined) return null;
	const done = todos.todos.filter((todo) => todo.done).length;
	const count = `${done}/${todos.todos.length}`;
	const chip = narrow ? !opened : collapsed;
	const fold = () => {
		if (narrow) return setOpened(false);
		setCollapsed(true);
		writeCollapsed(chatId, true);
	};
	const unfold = () => {
		if (narrow) return setOpened(true);
		setCollapsed(false);
		writeCollapsed(chatId, false);
	};
	if (chip)
		return (
			<button
				type="button"
				data-todo-card="chip"
				aria-expanded={false}
				onClick={unfold}
				className="absolute top-11 right-2 z-10 flex items-center gap-1.5 border border-bg2 bg-bg1 px-2 py-0.5 text-[11px] text-dim tabular-nums hover:text-fg"
			>
				<HugeiconsIcon
					icon={CheckmarkSquare02Icon}
					className="size-icon-sm flex-none"
				/>
				{count}
			</button>
		);
	return (
		<div
			data-todo-card="card"
			className="absolute top-11 right-2 z-10 flex w-64 max-w-[calc(100%-1.5rem)] flex-col gap-1.5 border border-bg2 bg-bg1 px-3 py-2 text-[12px]"
		>
			<button
				type="button"
				aria-expanded
				onClick={fold}
				className="flex items-center gap-2 text-left text-[11px] text-dim hover:text-fg"
			>
				<span className="flex-1">todos</span>
				<span className="tabular-nums">{count}</span>
			</button>
			{todos.progress && <ProgressBar progress={todos.progress} />}
			<ul className="flex flex-col gap-0.5">
				{todos.todos.map((todo) => (
					<li
						key={todo.label}
						data-done={todo.done}
						className="flex items-center gap-2"
					>
						<HugeiconsIcon
							icon={todo.done ? CheckmarkSquare02Icon : SquareIcon}
							className={`size-icon flex-none ${todo.done ? "text-green" : "text-dim"}`}
						/>
						<span
							className={`min-w-0 break-words ${todo.done ? "text-dim line-through" : "text-fg"}`}
						>
							{todo.label}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}
