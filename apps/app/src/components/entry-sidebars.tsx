import { SortableSides } from "@repo/components";
import type { ReactNode } from "react";
import { panelCarry } from "../lib/panel-ops.ts";
import { useSidebarSides } from "../lib/sidebar.ts";
import { ENTRY_PAGES, EntryDragged } from "./entry-rail.tsx";
import { FoldersProvider, useCloseFolder } from "./workspace-tree.tsx";

function DraggableEntries({ children }: { children: ReactNode }) {
	const { shown, move } = useSidebarSides();
	const closeFolder = useCloseFolder();
	return (
		<SortableSides
			sides={shown}
			onMove={move}
			onPickUp={closeFolder}
			overlay={(entry) => <EntryDragged entry={entry} />}
			also={(entry) => {
				const page = ENTRY_PAGES[entry];
				return page && panelCarry(page);
			}}
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
