import { SortableSides } from "@repo/components";
import type { ReactNode } from "react";
import { useSidebarMotion, useSidebarSides } from "../lib/sidebar.ts";
import { EntryDragged } from "./entry-rail.tsx";
import { FoldersProvider, useCloseFolder } from "./workspace-tree.tsx";

function DraggableEntries({ children }: { children: ReactNode }) {
	const { shown, move } = useSidebarSides();
	const { motion } = useSidebarMotion();
	const closeFolder = useCloseFolder();
	return (
		<SortableSides
			sides={shown}
			onMove={move}
			onPickUp={closeFolder}
			motion={motion}
			overlay={(entry) => <EntryDragged entry={entry} />}
		>
			{children}
		</SortableSides>
	);
}

export function EntrySidebars({ children }: { children: ReactNode }) {
	return (
		<FoldersProvider>
			<DraggableEntries>{children}</DraggableEntries>
		</FoldersProvider>
	);
}
