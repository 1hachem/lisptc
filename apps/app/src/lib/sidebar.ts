import type { MotionId } from "@repo/ui/motions.ts";
import { useCallback, useEffect, useMemo } from "react";
import { usePreferences, usePutPreferences } from "./preferences.ts";
import { motionOf } from "./resolved-preferences.ts";
import {
	type SidebarEntry,
	shownEntries,
	sidebarOrder,
	toggledHidden,
	withHidden,
} from "./sidebar-order.ts";

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

	const toggleHidden = useCallback(
		(name: SidebarEntry) =>
			put({ hidden: toggledHidden(stored?.hidden, name) }),
		[put, stored?.hidden],
	);

	return {
		order,
		shown,
		hidden: stored?.hidden ?? [],
		reorder,
		toggleHidden,
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
