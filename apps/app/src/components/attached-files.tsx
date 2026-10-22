import { FileTree, TreeFile } from "@repo/components";
import type { AttachedFile } from "@repo/knowledge-extension/attached";
import { Link } from "@tanstack/react-router";
import { useChatSession } from "../lib/chat.tsx";
import { knowledgeIcon } from "../lib/knowledge.ts";

function AttachedRow({ file }: { file: AttachedFile }) {
	const workspaceId = useChatSession((state) => state.workspaceId);
	const params = { workspaceId, name: file.name };
	return (
		<TreeFile
			name={file.name}
			icon={knowledgeIcon(file.name, null)}
			iconLabel={`${file.folder}/${file.name}`}
			selected={false}
			link={(content, className) =>
				file.folder === "knowledge" ? (
					<Link
						to="/$workspaceId/knowledge/$name"
						params={params}
						className={className}
					>
						{content}
					</Link>
				) : (
					<Link
						to="/$workspaceId/attachments/$name"
						params={params}
						className={className}
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
