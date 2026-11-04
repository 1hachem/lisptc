import type { MotionId } from "@repo/ui/motions.ts";
import { useCallback, useEffect, useMemo } from "react";
import { usePreferences, usePutPreferences } from "./preferences.ts";
import { motionOf } from "./resolved-preferences.ts";
import {
	currentNames,
	type SidebarEntry,
	type SidebarSides,
	shownEntries,
	sidebarSides,
	toggledEntry,
	withHiddenSides,
} from "./sidebar-order.ts";

function same(
	stored: readonly string[] | undefined,
	resolved: readonly string[],
): boolean {
	return stored?.join("\n") === resolved.join("\n");
}

export function useSidebarSides() {
	const stored = usePreferences();
	const put = usePutPreferences();
	const sides = useMemo(
		() => sidebarSides(stored?.sidebar, stored?.sidebarRight),
		[stored?.sidebar, stored?.sidebarRight],
	);
	const shown: SidebarSides = useMemo(
		() => ({
			left: shownEntries(sides.left, stored?.hidden),
			right: shownEntries(sides.right, stored?.hidden),
		}),
		[sides, stored?.hidden],
	);
	const complete =
		same(stored?.sidebar, sides.left) &&
		same(stored?.sidebarRight, sides.right);
	const hiddenNow = currentNames(stored?.hidden);
	const hiddenRenamed = !same(stored?.hidden, hiddenNow);

	useEffect(() => {
		if (stored !== undefined && !complete)
			put({ sidebar: [...sides.left], sidebarRight: [...sides.right] });
	}, [stored, complete, sides, put]);

	useEffect(() => {
		if (stored?.hidden !== undefined && hiddenRenamed)
			put({ hidden: currentNames(stored.hidden) });
	}, [stored?.hidden, hiddenRenamed, put]);

	const move = useCallback(
		(next: SidebarSides) => {
			const placed = withHiddenSides(next, sides);
			put({ sidebar: [...placed.left], sidebarRight: [...placed.right] });
		},
		[put, sides],
	);

	const toggle = useCallback(
		(entry: SidebarEntry) =>
			put({ hidden: toggledEntry(stored?.hidden, entry) }),
		[put, stored?.hidden],
	);

	return { sides, shown, hidden: hiddenNow, move, toggle };
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
