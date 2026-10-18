import type { MotionId } from "@repo/ui/motions.ts";
import { useCallback, useEffect, useMemo } from "react";
import { usePreferences, usePutPreferences } from "./preferences.ts";
import { motionOf } from "./resolved-preferences.ts";
import {
	entriesFor,
	type SidebarEntry,
	shownEntries,
	sidebarOrder,
	withHidden,
} from "./sidebar-order.ts";
import { useVerticalOwner } from "./vertical-owner.ts";

export function useSidebarOrder() {
	const stored = usePreferences();
	const put = usePutPreferences();
	const order = useMemo(() => sidebarOrder(stored?.sidebar), [stored?.sidebar]);
	const shown = useMemo(
		() => shownEntries(order, stored?.hidden),
		[order, stored?.hidden],
	);
	const complete = stored?.sidebar?.join("\n") === order.join("\n");

	useEffect(() => {
		if (stored !== undefined && !complete) put({ sidebar: order });
	}, [stored, complete, order, put]);

	const reorder = useCallback(
		(next: SidebarEntry[]) => put({ sidebar: withHidden(next, order) }),
		[put, order],
	);

	const owner = useVerticalOwner();
	return {
		order: entriesFor(order, owner),
		shown: entriesFor(shown, owner),
		hidden: entriesFor(stored?.hidden ?? [], owner),
		reorder,
	};
}

export function useSidebarMotion() {
	const stored = usePreferences();
	const put = usePutPreferences();
	const chooseMotion = useCallback(
		(id: MotionId) => put({ motion: id }),
		[put],
	);
	return { motion: motionOf(stored), chooseMotion };
}
