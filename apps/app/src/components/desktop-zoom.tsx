import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useDesktopZoom } from "../lib/desktop-shell.ts";

const BUTTON_CLASS =
	"flex h-full flex-none cursor-pointer items-center px-1 hover:text-foreground";

export function DesktopZoom() {
	const { factor, zoom } = useDesktopZoom();
	if (factor === undefined) return null;
	return (
		<span className="flex h-full flex-none items-center px-1.5">
			<button
				type="button"
				onClick={() => zoom("out")}
				title="Zoom out (Ctrl -)"
				className={BUTTON_CLASS}
			>
				<HugeiconsIcon icon={MinusSignIcon} className="size-icon-sm" />
			</button>
			<button
				type="button"
				onClick={() => zoom("reset")}
				title="Reset zoom (Ctrl 0)"
				className={`${BUTTON_CLASS} tabular-nums`}
			>
				{Math.round(factor * 100)}%
			</button>
			<button
				type="button"
				onClick={() => zoom("in")}
				title="Zoom in (Ctrl +)"
				className={BUTTON_CLASS}
			>
				<HugeiconsIcon icon={PlusSignIcon} className="size-icon-sm" />
			</button>
		</span>
	);
}
