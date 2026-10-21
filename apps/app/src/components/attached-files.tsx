import { FileTree, TreeFile } from "@repo/components";
import type { AttachedFile } from "../lib/attached-files.ts";
import { useChatSession } from "../lib/chat.tsx";
import { knowledgeIcon } from "../lib/knowledge.ts";
import { type PanelContent, startPanelDrag } from "../lib/panel-ops.ts";
import { PanelLink } from "./panel-link.tsx";

function AttachedRow({ file }: { file: AttachedFile }) {
	const workspaceId = useChatSession((state) => state.workspaceId);
	const opens: PanelContent = {
		kind: "file",
		folder: file.folder,
		name: file.name,
	};
	return (
		<TreeFile
			name={file.name}
			icon={knowledgeIcon(file.name, null)}
			iconLabel={`${file.folder}/${file.name}`}
			selected={false}
			onDragStart={(event) => startPanelDrag(event.dataTransfer, opens)}
			link={(content, className) => (
				<PanelLink
					workspaceId={workspaceId}
					content={opens}
					className={className}
				>
					{content}
				</PanelLink>
			)}
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
