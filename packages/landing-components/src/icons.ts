import {
	AiBrain01Icon,
	ArrowRight01Icon,
	ChartLineData01Icon,
	CheckmarkCircle02Icon,
	Clock01Icon,
	CodeIcon,
	CubeIcon,
	FlashIcon,
	Layers01Icon,
	PuzzleIcon,
	RocketIcon,
	Settings02Icon,
	Shield01Icon,
	SparklesIcon,
	UserGroupIcon,
	WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";

export type LandingIcon = typeof CubeIcon;

export const landingIcons: Readonly<Record<string, LandingIcon>> = {
	brain: AiBrain01Icon,
	chart: ChartLineData01Icon,
	check: CheckmarkCircle02Icon,
	clock: Clock01Icon,
	code: CodeIcon,
	cube: CubeIcon,
	flash: FlashIcon,
	layers: Layers01Icon,
	puzzle: PuzzleIcon,
	rocket: RocketIcon,
	settings: Settings02Icon,
	shield: Shield01Icon,
	sparkles: SparklesIcon,
	team: UserGroupIcon,
	workflow: WorkflowSquare01Icon,
};

export const arrowIcon: LandingIcon = ArrowRight01Icon;

export function landingIcon(name: string | undefined): LandingIcon | undefined {
	return name === undefined ? undefined : landingIcons[name];
}
