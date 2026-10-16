import type { MotionId } from "@repo/ui/motions.ts";
import { useCallback, useEffect, useMemo } from "react";
import { usePreferences, usePutPreferences } from "./preferences.ts";
import { motionOf } from "./resolved-preferences.ts";
import { type SidebarEntry, sidebarOrder } from "./sidebar-order.ts";

export function useSidebarOrder() {
	const stored = usePreferences();
	const put = usePutPreferences();
	const order = useMemo(() => sidebarOrder(stored?.sidebar), [stored?.sidebar]);
	const complete = stored?.sidebar?.join("\n") === order.join("\n");

	useEffect(() => {
		if (stored !== undefined && !complete) put({ sidebar: order });
	}, [stored, complete, order, put]);

	const reorder = useCallback(
		(next: SidebarEntry[]) => put({ sidebar: next }),
		[put],
	);

	return { order, reorder };
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
