import type { IconSvgElement } from "@hugeicons/react";
import type { Id } from "@repo/backend/dataModel";
import { type TreeCheck, TreeGroup } from "@repo/components";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";
import { byDate } from "../lib/date-groups.ts";

export type FolderState<Name extends string = string> = {
	name: Name;
	icon: IconSvgElement;
	open: boolean;
	onToggle: () => void;
};

export function useLeave(workspaceId: Id<"workspaces">) {
	const navigate = useNavigate();
	return (selected: boolean) =>
		selected
			? navigate({
					to: "/$workspaceId",
					params: { workspaceId },
					replace: true,
				})
			: Promise.resolve();
}

export function Empty({ children }: { children: ReactNode }) {
	return <div className="py-1 pl-9 text-dim">{children}</div>;
}

export function Listing<T>({
	items,
	empty,
	children,
}: {
	items: T[] | undefined;
	empty: string | null;
	children: (item: T) => ReactNode;
}) {
	if (items === undefined) return null;
	if (items.length === 0) return empty && <Empty>{empty}</Empty>;
	return items.map(children);
}

export function DatedListing<T>({
	items,
	at,
	empty,
	check,
	children,
}: {
	items: T[] | undefined;
	at: (item: T) => number;
	empty: string | null;
	check: (items: T[]) => TreeCheck;
	children: (item: T) => ReactNode;
}) {
	if (items === undefined) return null;
	if (items.length === 0) return empty && <Empty>{empty}</Empty>;
	return byDate(items, at, Date.now()).map(({ group, items: dated }) => (
		<Fragment key={group}>
			<TreeGroup label={group} check={check(dated)} />
			{dated.map(children)}
		</Fragment>
	));
}
