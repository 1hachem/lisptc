import type { Id } from "@repo/backend/dataModel";
import { Link, useParams } from "@tanstack/react-router";
import type { DragEvent, MouseEvent, ReactNode } from "react";
import type { PanelContent } from "../lib/panel-ops.ts";
import { panelPath } from "../lib/panel-paths.ts";
import { requestPanel } from "../lib/panel-requests.ts";

function opensInPlace(event: MouseEvent): boolean {
	return (
		event.button === 0 &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		!event.altKey
	);
}

export function PanelLink({
	workspaceId,
	content,
	className,
	title,
	label,
	onDragStart,
	onClick,
	children,
}: {
	workspaceId: Id<"workspaces">;
	content: PanelContent;
	className?: string;
	title?: string;
	label?: string;
	onDragStart?: (event: DragEvent) => void;
	onClick?: () => void;
	children: ReactNode;
}) {
	return (
		<Link
			to="/app/$workspaceId/$"
			params={{ workspaceId, _splat: panelPath(content) ?? "" }}
			className={className}
			title={title}
			aria-label={label}
			onDragStart={onDragStart}
			onClick={(event) => {
				onClick?.();
				if (!opensInPlace(event)) return;
				event.preventDefault();
				requestPanel(content);
			}}
		>
			{children}
		</Link>
	);
}

export function useShown(): (content: PanelContent) => boolean {
	const at = useParams({ strict: false })._splat ?? "";
	return (content) => at !== "" && panelPath(content) === at;
}

export function linkTo(workspaceId: Id<"workspaces">, content: PanelContent) {
	return (children: ReactNode, className: string) => (
		<PanelLink
			workspaceId={workspaceId}
			content={content}
			className={className}
		>
			{children}
		</PanelLink>
	);
}
