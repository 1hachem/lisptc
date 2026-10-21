import { useCallback, useEffect, useMemo } from "react";
import { usePreferences, usePutPreferences } from "./preferences.ts";
import {
	type BarItem,
	barOrder,
	reorderedShown,
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
		(next: BarItem[]) => put({ statusBar: next }),
		[put],
	);

	const toggle = useCallback(
		(item: BarItem) =>
			put({ statusBarHidden: toggledItem(stored?.statusBarHidden, item) }),
		[put, stored?.statusBarHidden],
	);

	const reorderShown = useCallback(
		(next: BarItem[]) => put({ statusBar: reorderedShown(order, next) }),
		[put, order],
	);

	return { order, shown, reorder, reorderShown, toggle };
}
