import { FileTree, TreeFile } from "@repo/components";
import { Link } from "@tanstack/react-router";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { AttachedFile } from "../lib/attached-files.ts";
import { useChatSession } from "../lib/chat.tsx";
import { knowledgeIcon } from "../lib/knowledge.ts";
import { startPanelDrag } from "../lib/panel-ops.ts";
import { usePanels } from "../lib/panels.tsx";

function inPlace(event: MouseEvent): boolean {
	return (
		event.button === 0 &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		!event.altKey
	);
}

function AttachedRow({ file }: { file: AttachedFile }) {
	const workspaceId = useChatSession((state) => state.workspaceId);
	const { openFile } = usePanels();
	const params = { workspaceId, name: file.name };
	const onClick = (event: ReactMouseEvent) => {
		if (!inPlace(event.nativeEvent)) return;
		event.preventDefault();
		openFile(file.folder, file.name);
	};
	return (
		<TreeFile
			name={file.name}
			icon={knowledgeIcon(file.name, null)}
			iconLabel={`${file.folder}/${file.name}`}
			selected={false}
			onDragStart={(event) =>
				startPanelDrag(event.dataTransfer, {
					kind: "file",
					folder: file.folder,
					name: file.name,
				})
			}
			link={(content, className) =>
				file.folder === "knowledge" ? (
					<Link
						to="/$workspaceId/knowledge/$name"
						params={params}
						className={className}
						onClick={onClick}
					>
						{content}
					</Link>
				) : (
					<Link
						to="/$workspaceId/attachments/$name"
						params={params}
						className={className}
						onClick={onClick}
					>
						{content}
					</Link>
				)
			}
		/>
	);
}

export function AttachedFiles({ files }: { files: readonly AttachedFile[] }) {
	if (files.length === 0) return null;
	return (
		<FileTree>
			<ul aria-label="attachments" className="mt-1 -ml-2.5">
				{files.map((file) => (
					<li key={`${file.folder}/${file.name}`}>
						<AttachedRow file={file} />
					</li>
				))}
			</ul>
		</FileTree>
	);
}
