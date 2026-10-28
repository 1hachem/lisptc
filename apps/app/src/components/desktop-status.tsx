import { convexQuery } from "@convex-dev/react-query";
import { ComputerIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";

export function DesktopStatus() {
	const { data: desktop } = useQuery(convexQuery(api.desktops.mine, {}));
	if (desktop?.connected !== true) return null;
	return (
		<span className="flex h-full flex-none items-center gap-1.5 px-2.5">
			<HugeiconsIcon icon={ComputerIcon} className="size-icon-sm flex-none" />
			desktop connected
		</span>
	);
}
