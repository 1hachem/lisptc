import { convexQuery } from "@convex-dev/react-query";
import {
	ComputerArrowDownIcon,
	ComputerIcon,
	ComputerRemoveIcon,
	Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	useDesktopConnection,
	useDesktopUpdate,
} from "../lib/desktop-shell.ts";

function useSecondsUntil(at: number | undefined): number {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (at === undefined) return;
		setNow(Date.now());
		const ticking = setInterval(() => setNow(Date.now()), 1_000);
		return () => clearInterval(ticking);
	}, [at]);
	return at === undefined ? 0 : Math.max(0, Math.ceil((at - now) / 1_000));
}

export function DesktopStatus() {
	const { data: desktop } = useQuery(convexQuery(api.desktops.mine, {}));
	const { ready, install } = useDesktopUpdate();
	const { state: bridge, reconnect } = useDesktopConnection();
	const seconds = useSecondsUntil(
		bridge?.status === "failed" ? bridge.retryAt : undefined,
	);
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
	if (bridge?.status === "failed")
		return (
			<button
				type="button"
				onClick={reconnect}
				title="Retry now"
				className="flex h-full flex-none cursor-pointer items-center gap-1.5 px-2.5 text-destructive hover:text-foreground"
			>
				<HugeiconsIcon
					icon={ComputerRemoveIcon}
					className="size-icon-sm flex-none"
				/>
				desktop failed, retrying in {seconds}s
			</button>
		);
	if (
		bridge !== undefined &&
		(bridge.status === "connecting" || desktop?.connected !== true)
	)
		return (
			<span className="flex h-full flex-none items-center gap-1.5 px-2.5">
				<HugeiconsIcon
					icon={Loading03Icon}
					className="size-icon-sm flex-none animate-spin"
				/>
				desktop connecting
			</span>
		);
	if (desktop?.connected !== true) return null;
	return (
		<span className="flex h-full flex-none items-center gap-1.5 px-2.5">
			<HugeiconsIcon icon={ComputerIcon} className="size-icon-sm flex-none" />
			desktop connected
		</span>
	);
}
