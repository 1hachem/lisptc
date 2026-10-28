import {
	AppleIcon,
	ComputerTerminal01Icon,
	WindowsNewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
	DESKTOP_DOWNLOADS,
	type DesktopDownload,
	type DesktopOs,
	primaryDownload,
	visitorPlatform,
} from "../lib/desktop-downloads.ts";
import { inDesktopShell } from "../lib/desktop-shell.ts";

export const Route = createFileRoute("/download")({
	component: Download,
});

const OS_ICONS: Record<DesktopOs, IconSvgElement> = {
	mac: AppleIcon,
	windows: WindowsNewIcon,
	linux: ComputerTerminal01Icon,
};

interface Release {
	tag: string;
	publishedAt: string;
}

function useLatestRelease(): Release | null {
	const [release, setRelease] = useState<Release | null>(null);
	useEffect(() => {
		void fetch("/api/release")
			.then((response) => (response.ok ? response.json() : null))
			.then(setRelease)
			.catch(() => setRelease(null));
	}, []);
	return release;
}

function Download() {
	const [primary, setPrimary] = useState<DesktopDownload>();
	const [shell, setShell] = useState(false);
	const release = useLatestRelease();

	useEffect(() => {
		setPrimary(primaryDownload(visitorPlatform()));
		setShell(inDesktopShell());
	}, []);

	const others = DESKTOP_DOWNLOADS.filter((download) => download !== primary);

	return (
		<div className="flex h-full items-center justify-center bg-bg font-mono text-[13px] text-fg">
			<div className="flex w-[360px] flex-col gap-3.5">
				<div>the salsal desktop app</div>
				{release ? (
					<div className="text-[11.5px] text-dim">
						latest: {release.tag} ·{" "}
						{new Date(release.publishedAt).toLocaleDateString()}
					</div>
				) : null}

				{shell ? (
					<div className="text-dim">you are already in the desktop app.</div>
				) : (
					<>
						{primary ? (
							<Link
								to="/download/thanks"
								search={{ file: primary.id }}
								className="flex items-center gap-2 bg-bg2 px-2.5 py-1 text-blue hover:brightness-125"
							>
								<HugeiconsIcon
									icon={OS_ICONS[primary.os]}
									className="size-icon-sm"
								/>
								download for {primary.label}
							</Link>
						) : null}
						<div className="flex flex-col gap-1">
							{others.map((download) => (
								<Link
									key={download.id}
									to="/download/thanks"
									search={{ file: download.id }}
									className="flex items-center gap-2 text-dim hover:text-fg"
								>
									<HugeiconsIcon
										icon={OS_ICONS[download.os]}
										className="size-icon-sm"
									/>
									{download.label}
								</Link>
							))}
						</div>
					</>
				)}

				<div className="flex flex-col gap-1 text-[11.5px] text-dim">
					<div>macOS: right-click the app and choose open the first time.</div>
					<div>linux: chmod +x salsal.AppImage, then run it.</div>
				</div>
			</div>
		</div>
	);
}
