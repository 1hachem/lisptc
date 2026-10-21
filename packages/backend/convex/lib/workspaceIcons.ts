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
