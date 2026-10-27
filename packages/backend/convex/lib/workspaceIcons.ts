export const WORKSPACE_ICONS = [
	"folder",
	"rocket",
	"flask",
	"book",
	"star",
	"leaf",
	"code",
	"globe",
	"heart",
	"bolt",
	"briefcase",
	"palette",
] as const;

export type WorkspaceIcon = (typeof WORKSPACE_ICONS)[number];

function spread(id: string): number {
	let hash = 0;
	for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	return hash;
}

export function workspaceIcon(workspace: {
	_id: string;
	icon?: WorkspaceIcon;
}): WorkspaceIcon {
	return (
		workspace.icon ??
		WORKSPACE_ICONS[spread(workspace._id) % WORKSPACE_ICONS.length]
	);
}
