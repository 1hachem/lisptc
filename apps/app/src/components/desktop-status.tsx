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

function useSecondsUntil(at: number): number {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const ticking = setInterval(() => setNow(Date.now()), 1_000);
		return () => clearInterval(ticking);
	}, []);
	return Math.max(0, Math.ceil((at - now) / 1_000));
}

type Phase = "connected" | "connecting" | "failed" | "off";

function phaseOf(
	bridge: ReturnType<typeof useDesktopConnection>["state"],
	confirmed: boolean,
): Phase {
	if (bridge?.status === "failed") return "failed";
	if (confirmed && bridge?.status !== "connecting") return "connected";
	return bridge === undefined ? "off" : "connecting";
}

function Failed({
	retryAt,
	onRetry,
}: {
	retryAt: number;
	onRetry: () => void;
}) {
	const seconds = useSecondsUntil(retryAt);
	return (
		<button
			type="button"
			onClick={onRetry}
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
}

function Label({ phase }: { phase: "connected" | "connecting" }) {
	return (
		<span className="flex h-full flex-none items-center gap-1.5 px-2.5">
			<HugeiconsIcon
				icon={phase === "connected" ? ComputerIcon : Loading03Icon}
				className={`size-icon-sm flex-none ${phase === "connecting" ? "animate-spin" : ""}`}
			/>
			desktop {phase}
		</span>
	);
}

function UpdateReady({
	version,
	onInstall,
}: {
	version: string;
	onInstall: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onInstall}
			title={`Restart to update to ${version}`}
			className="flex h-full flex-none cursor-pointer items-center gap-1.5 px-2.5 hover:text-foreground"
		>
			<HugeiconsIcon
				icon={ComputerArrowDownIcon}
				className="size-icon-sm flex-none"
			/>
			update ready
		</button>
	);
}

export function DesktopStatus() {
	const { data: desktop } = useQuery(convexQuery(api.desktops.mine, {}));
	const { ready, install } = useDesktopUpdate();
	const { state: bridge, reconnect } = useDesktopConnection();
	if (ready !== undefined)
		return <UpdateReady version={ready} onInstall={install} />;
	if (bridge?.status === "failed")
		return <Failed retryAt={bridge.retryAt} onRetry={reconnect} />;
	const phase = phaseOf(bridge, desktop?.connected === true);
	return phase === "off" || phase === "failed" ? null : <Label phase={phase} />;
}
