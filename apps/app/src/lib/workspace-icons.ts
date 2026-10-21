import {
	Book02Icon,
	Briefcase01Icon,
	CodeIcon,
	FavouriteIcon,
	FlashIcon,
	Folder01Icon,
	Globe02Icon,
	Leaf01Icon,
	PaintBoardIcon,
	Rocket01Icon,
	StarIcon,
	TestTube01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { WorkspaceIcon } from "@repo/backend/workspace-icons";

export const ICONS: Record<WorkspaceIcon, IconSvgElement> = {
	folder: Folder01Icon,
	rocket: Rocket01Icon,
	flask: TestTube01Icon,
	book: Book02Icon,
	star: StarIcon,
	leaf: Leaf01Icon,
	code: CodeIcon,
	globe: Globe02Icon,
	heart: FavouriteIcon,
	bolt: FlashIcon,
	briefcase: Briefcase01Icon,
	palette: PaintBoardIcon,
};
