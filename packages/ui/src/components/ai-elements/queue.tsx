"use client";

import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";

export type QueueProps = ComponentProps<"div">;

export const Queue = ({ className, ...props }: QueueProps) => (
	<div
		className={cn(
			"flex flex-col gap-2 rounded-xl border border-border bg-background px-3 pt-2 pb-2 shadow-xs",
			className,
		)}
		{...props}
	/>
);

export type QueueListProps = ComponentProps<typeof ScrollArea>;

export const QueueList = ({
	children,
	className,
	...props
}: QueueListProps) => (
	<ScrollArea className={cn("-mb-1", className)} {...props}>
		<div className="max-h-40 pr-4">
			<ul>{children}</ul>
		</div>
	</ScrollArea>
);

export type QueueItemProps = ComponentProps<"li">;

export const QueueItem = ({ className, ...props }: QueueItemProps) => (
	<li
		className={cn(
			"group flex items-center gap-2 rounded-md px-3 py-1 text-sm transition-colors hover:bg-muted",
			className,
		)}
		{...props}
	/>
);

export type QueueItemIndicatorProps = ComponentProps<"span"> & {
	completed?: boolean;
};

export const QueueItemIndicator = ({
	completed = false,
	className,
	...props
}: QueueItemIndicatorProps) => (
	<span
		className={cn(
			"inline-block size-2.5 shrink-0 rounded-full border",
			completed
				? "border-muted-foreground/20 bg-muted-foreground/10"
				: "border-muted-foreground/50",
			className,
		)}
		{...props}
	/>
);

export type QueueItemContentProps = ComponentProps<"span"> & {
	completed?: boolean;
};

export const QueueItemContent = ({
	completed = false,
	className,
	...props
}: QueueItemContentProps) => (
	<span
		className={cn(
			"line-clamp-1 grow break-words",
			completed
				? "text-muted-foreground/50 line-through"
				: "text-muted-foreground",
			className,
		)}
		{...props}
	/>
);

export type QueueItemActionsProps = ComponentProps<"div">;

export const QueueItemActions = ({
	className,
	...props
}: QueueItemActionsProps) => (
	<div className={cn("flex gap-1", className)} {...props} />
);

export type QueueItemActionProps = Omit<
	ComponentProps<typeof Button>,
	"variant" | "size"
>;

export const QueueItemAction = ({
	className,
	...props
}: QueueItemActionProps) => (
	<Button
		className={cn(
			"size-auto rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted-foreground/10 hover:text-foreground group-hover:opacity-100",
			className,
		)}
		size="icon"
		type="button"
		variant="ghost"
		{...props}
	/>
);
