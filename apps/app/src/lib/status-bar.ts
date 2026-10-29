import type { StatusBarItem } from "@repo/shared/status-bar";
import { useCallback, useEffect, useMemo } from "react";
import { usePreferences, usePutPreferences } from "./preferences.ts";
import {
	type BarSlot,
	barOrder,
	shownItems,
	toggledItem,
} from "./status-bar-order.ts";

export function useStatusBarOrder() {
	const stored = usePreferences();
	const put = usePutPreferences();
	const order = useMemo(() => barOrder(stored?.statusBar), [stored?.statusBar]);
	const shown = useMemo(
		() => shownItems(order, stored?.statusBarHidden),
		[order, stored?.statusBarHidden],
	);
	const complete = stored?.statusBar?.join("\n") === order.join("\n");

	useEffect(() => {
		if (stored !== undefined && !complete) put({ statusBar: order });
	}, [stored, complete, order, put]);

	const reorder = useCallback(
		(next: BarSlot[]) => put({ statusBar: next }),
		[put],
	);

	const toggle = useCallback(
		(item: StatusBarItem) =>
			put({ statusBarHidden: toggledItem(stored?.statusBarHidden, item) }),
		[put, stored?.statusBarHidden],
	);

	return { order, shown, reorder, toggle };
}
