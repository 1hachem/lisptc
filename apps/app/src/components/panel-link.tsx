import type { Id } from "@repo/backend/dataModel";
import { useDragSource } from "@repo/components";
import { Link, useParams } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";
import { type PanelContent, panelCarry } from "../lib/panel-ops.ts";
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
	carries = false,
	onClick,
	children,
}: {
	workspaceId: Id<"workspaces">;
	content: PanelContent;
	className?: string;
	title?: string;
	label?: string;
	carries?: boolean;
	onClick?: () => void;
	children: ReactNode;
}) {
	const source = useDragSource(() => panelCarry(content));
	return (
		<Link
			{...(carries ? source : {})}
			to="/app/$workspaceId/$"
			params={{ workspaceId, _splat: panelPath(content) ?? "" }}
			className={className}
			title={title}
			aria-label={label}
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
