import type { MotionId } from "@repo/ui/motions.ts";
import { useCallback, useEffect, useMemo } from "react";
import { usePreferences, usePutPreferences } from "./preferences.ts";
import { motionOf } from "./resolved-preferences.ts";
import {
	currentNames,
	type SidebarEntry,
	shownEntries,
	sidebarOrder,
	toggledEntry,
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
	const hiddenNow = currentNames(stored?.hidden);
	const hiddenRenamed = stored?.hidden?.join("\n") !== hiddenNow.join("\n");

	useEffect(() => {
		if (stored !== undefined && !complete) put({ sidebar: order });
	}, [stored, complete, order, put]);

	useEffect(() => {
		if (stored?.hidden !== undefined && hiddenRenamed)
			put({ hidden: currentNames(stored.hidden) });
	}, [stored?.hidden, hiddenRenamed, put]);

	const reorder = useCallback(
		(next: SidebarEntry[]) => put({ sidebar: withHidden(next, order) }),
		[put, order],
	);

	const toggle = useCallback(
		(entry: SidebarEntry) =>
			put({ hidden: toggledEntry(stored?.hidden, entry) }),
		[put, stored?.hidden],
	);

	return { order, shown, hidden: hiddenNow, reorder, toggle };
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
