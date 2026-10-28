import { convexQuery } from "@convex-dev/react-query";
import {
	ComputerArrowDownIcon,
	ComputerIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { useDesktopUpdate } from "../lib/desktop-shell.ts";

export function DesktopStatus() {
	const { data: desktop } = useQuery(convexQuery(api.desktops.mine, {}));
	const { ready, install } = useDesktopUpdate();
	if (ready !== undefined)
		return (
			<button
				type="button"
				onClick={install}
				title={`Restart to update to ${ready}`}
				className="flex h-full flex-none cursor-pointer items-center gap-1.5 px-2.5 hover:text-foreground"
			>
				<HugeiconsIcon
					icon={ComputerArrowDownIcon}
					className="size-icon-sm flex-none"
				/>
				update ready
			</button>
		);
	if (desktop?.connected !== true) return null;
	return (
		<span className="flex h-full flex-none items-center gap-1.5 px-2.5">
			<HugeiconsIcon icon={ComputerIcon} className="size-icon-sm flex-none" />
			desktop connected
		</span>
	);
}
