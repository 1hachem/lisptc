import { TreeAction, TreeSelection } from "@repo/components";
import { useState } from "react";
import { useAttempt } from "../lib/attempt.ts";
import { eachOf, saveAs, type useSelection } from "../lib/file-list.ts";

function useBulk(source: string) {
	const { failure, attempt } = useAttempt(source);
	const [busy, setBusy] = useState(false);
	return {
		failure,
		busy,
		run: (work: () => Promise<unknown>) =>
			attempt(async () => {
				setBusy(true);
				try {
					await work();
				} finally {
					setBusy(false);
				}
			}),
	};
}

export function BulkToolbar({
	selection,
	total,
	folder,
	current,
	leave,
	served,
	confirm,
	onDelete,
	onRestore,
}: {
	selection: ReturnType<typeof useSelection>;
	total: number;
	folder: string;
	current: string | undefined;
	leave: (selected: boolean) => Promise<unknown>;
	served: (name: string) => Promise<{ url: string | null } | null>;
	confirm: string;
	onDelete: (names: string[]) => Promise<unknown>;
	onRestore?: (name: string) => Promise<unknown>;
}) {
	const bulk = useBulk(`${folder} bulk action`);
	const names = selection.selected;
	if (names.length === 0) return null;
	const picked = `${names.length} ${names.length === 1 ? "file" : "files"} selected`;
	const leaving = (work: () => Promise<unknown>) =>
		bulk.run(async () => {
			await leave(current !== undefined && names.includes(current));
			await work();
			selection.clear();
		});

	return (
		<TreeSelection
			count={names.length}
			total={total}
			label={`${picked} in ${folder}/`}
			summary={
				<>
					{picked} in <span className="text-blue">{folder}/</span>
				</>
			}
			allLabel="all"
			clearLabel="clear"
			onAll={selection.all}
			onClear={selection.clear}
			busy={bulk.busy}
			failure={bulk.failure}
		>
			<TreeAction
				label="download"
				onRun={() =>
					bulk.run(() =>
						eachOf(names, async (name) => {
							const file = await served(name);
							if (!file?.url) throw new Error("its bytes are gone");
							await saveAs(name, file.url);
						}),
					)
				}
			/>
			{onRestore && (
				<TreeAction
					label="restore"
					onRun={() => leaving(() => eachOf(names, onRestore))}
				/>
			)}
			<TreeAction
				label="delete"
				confirm={confirm}
				danger
				onRun={() => leaving(() => onDelete(names))}
			/>
		</TreeSelection>
	);
}
