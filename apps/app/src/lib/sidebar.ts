import type { MotionId } from "@repo/ui/motions.ts";
import { useCallback, useEffect, useMemo } from "react";
import { usePreferences, usePutPreferences } from "./preferences.ts";
import { motionOf } from "./resolved-preferences.ts";
import {
	type SidebarEntry,
	type SidebarSides,
	sidebarView,
	toggledEntry,
	withHiddenSides,
} from "./sidebar-order.ts";

export function useSidebarSides() {
	const stored = usePreferences();
	const put = usePutPreferences();
	const view = useMemo(() => sidebarView(stored ?? {}), [stored]);
	const { sides, outdated } = view;

	useEffect(() => {
		if (stored !== undefined && outdated !== undefined) put(outdated);
	}, [stored, outdated, put]);

	const move = useCallback(
		(next: SidebarSides) => {
			const placed = withHiddenSides(next, sides);
			put({ sidebar: [...placed.left], sidebarRight: [...placed.right] });
		},
		[put, sides],
	);

	const toggle = useCallback(
		(entry: SidebarEntry) => put({ hidden: toggledEntry(view.hidden, entry) }),
		[put, view.hidden],
	);

	return { ...view, move, toggle };
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
