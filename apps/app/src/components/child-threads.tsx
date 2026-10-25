import { convexQuery } from "@convex-dev/react-query";
import {
	AlertCircleIcon,
	CheckmarkCircle02Icon,
	GitBranchIcon,
	HelpCircleIcon,
	Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { Button } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { usePageHost } from "../lib/page-host.tsx";

export interface ChildThread {
	_id: string;
	title: string;
	status?: "streaming" | "waiting" | "errored";
	failure?: string;
}

type ThreadState = "running" | "waiting" | "errored" | "idle";

const STATE_OF: Record<NonNullable<ChildThread["status"]>, ThreadState> = {
	streaming: "running",
	waiting: "waiting",
	errored: "errored",
};

const ICON_OF: Record<ThreadState, IconSvgElement> = {
	running: Loading03Icon,
	waiting: HelpCircleIcon,
	errored: AlertCircleIcon,
	idle: CheckmarkCircle02Icon,
};

function threadState(thread: ChildThread): ThreadState {
	return thread.status === undefined ? "idle" : STATE_OF[thread.status];
}

export function ChildThreadStrip({
	threads,
	onOpen,
}: {
	threads: readonly ChildThread[];
	onOpen: (thread: ChildThread) => void;
}) {
	if (threads.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-1 px-2 pb-1 text-muted-foreground text-xs">
			<span className="flex items-center gap-1">
				<HugeiconsIcon icon={GitBranchIcon} className="size-icon-sm" />
				{threads.length === 1 ? "1 thread" : `${threads.length} threads`}
			</span>
			{threads.map((thread) => {
				const state = threadState(thread);
				return (
					<Button
						key={thread._id}
						variant="ghost"
						size="xs"
						data-state={state}
						title={thread.failure ?? state}
						className={state === "errored" ? "text-destructive" : undefined}
						onClick={() => onOpen(thread)}
					>
						<HugeiconsIcon
							icon={ICON_OF[state]}
							className={
								state === "running"
									? "size-icon-sm animate-spin"
									: "size-icon-sm"
							}
						/>
						{thread.title || "untitled"}
						<span className="sr-only">{state}</span>
					</Button>
				);
			})}
		</div>
	);
}

export function ChildThreads({ chatId }: { chatId: Id<"chats"> | null }) {
	const host = usePageHost();
	const { data } = useQuery(
		convexQuery(api.chats.children, chatId === null ? "skip" : { chatId }),
	);
	return (
		<ChildThreadStrip
			threads={data ?? []}
			onOpen={(thread) =>
				host.show({ kind: "chat", chatId: thread._id, title: thread.title })
			}
		/>
	);
}
