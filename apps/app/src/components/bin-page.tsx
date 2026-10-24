import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Doc, Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { restoreFailure } from "../lib/bin.ts";
import { usePageHost } from "../lib/page-host.tsx";
import { StoredFile } from "./stored-file.tsx";

function RestoreAction({
	workspaceId,
	name,
	from,
}: {
	workspaceId: Id<"workspaces">;
	name: string;
	from: Doc<"bin">["from"];
}) {
	const restore = useConvexMutation(api.bin.restore);
	const host = usePageHost();
	const [failure, setFailure] = useState<string | null>(null);
	return (
		<>
			{failure && <span className="text-red">{failure}</span>}
			<button
				type="button"
				className="text-dim hover:text-fg"
				onClick={async () => {
					const restored = await restore({ workspaceId, name });
					if ("refused" in restored) {
						setFailure(restoreFailure(restored.refused));
						return;
					}
					host.show({
						kind: "file",
						folder: restored.folder,
						name: restored.name,
					});
				}}
			>
				restore to {from}
			</button>
		</>
	);
}

export function BinPage({
	workspaceId,
	name,
}: {
	workspaceId: Id<"workspaces">;
	name: string;
}) {
	const { data: file, error } = useQuery(
		convexQuery(api.bin.get, { workspaceId, name }),
	);
	if (error) throw error;
	return (
		<StoredFile
			folder="bin"
			name={name}
			file={file}
			actions={
				file && (
					<RestoreAction
						workspaceId={workspaceId}
						name={name}
						from={file.from}
					/>
				)
			}
		/>
	);
}
