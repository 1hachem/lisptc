export const motions = [
	{ id: "slide", name: "the rows slide aside and the dragged one dims" },
	{ id: "lift", name: "the dragged row lifts and glides into its place" },
	{
		id: "overlay",
		name: "a floating copy follows the cursor and drops into place",
	},
	{ id: "none", name: "nothing animates" },
] as const;

export type MotionId = (typeof motions)[number]["id"];

export const defaultMotionId: MotionId = "slide";

export function isMotion(id: string | undefined): id is MotionId {
	return motions.some((motion) => motion.id === id);
}
