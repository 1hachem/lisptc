import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
	extend: {
		theme: {
			spacing: [
				"control-xs",
				"control-sm",
				"control",
				"control-lg",
				"icon-sm",
				"icon",
				"row",
				"switch-width-sm",
				"switch-width",
				"switch-height-sm",
				"switch-height",
			],
			container: ["dialog-sm", "dialog", "dialog-lg"],
		},
	},
});

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
