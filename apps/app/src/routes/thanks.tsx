import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
	chosenDownload,
	DESKTOP_DOWNLOADS,
	type DesktopDownload,
	type DesktopDownloadId,
	type DesktopOs,
	isDownloadId,
	startDownload,
	visitorPlatform,
} from "../lib/desktop-downloads.ts";
import { inDesktopShell } from "../lib/desktop-shell.ts";

const DOCS = "https://github.com/1hachem/lisptc#readme";

export const Route = createFileRoute("/thanks")({
	validateSearch: (
		search: Record<string, unknown>,
	): { file?: DesktopDownloadId } =>
		isDownloadId(search.file) ? { file: search.file } : {},
	component: Thanks,
});

const STEPS: Record<DesktopOs, readonly string[]> = {
	mac: [
		"open the .dmg and drag salsal to Applications.",
		"the first time, right-click salsal and choose open.",
	],
	windows: [
		"run salsal-setup.exe.",
		"if SmartScreen stops it, choose more info, then run anyway.",
	],
	linux: ["chmod +x salsal.AppImage", "run ./salsal.AppImage"],
};

function Thanks() {
	const { file } = Route.useSearch();
	const [chosen, setChosen] = useState<DesktopDownload>();
	const [shell, setShell] = useState(false);

	useEffect(() => {
		setShell(inDesktopShell());
		setChosen(chosenDownload(file, visitorPlatform()));
	}, [file]);

	const intel = DESKTOP_DOWNLOADS.find((download) => download.id === "mac-x64");

	return (
		<div className="flex h-full items-center justify-center bg-bg font-mono text-[13px] text-fg">
			<div className="flex w-[360px] flex-col gap-3.5">
				<div>thanks for downloading salsal</div>
				{shell ? (
					<div className="text-dim">you are already in the desktop app.</div>
				) : chosen ? (
					<>
						<div className="text-[11.5px] text-dim">
							{chosen.file} for {chosen.label} is downloading.{" "}
							<button
								type="button"
								onClick={() => startDownload(chosen.url)}
								className="text-blue hover:brightness-125"
							>
								didn't start? download again
							</button>
						</div>
						{chosen.id === "mac-arm64" && intel ? (
							<button
								type="button"
								onClick={() => startDownload(intel.url)}
								className="self-start text-[11.5px] text-dim hover:text-fg"
							>
								on an Intel mac? get {intel.file}
							</button>
						) : null}
						<ol className="flex list-decimal flex-col gap-1 pl-5">
							{STEPS[chosen.os].map((step) => (
								<li key={step}>{step}</li>
							))}
							<li>open salsal and sign in.</li>
						</ol>
					</>
				) : (
					<div className="text-dim">
						pick your installer on the download page.
					</div>
				)}
				<div className="flex gap-3 text-[11.5px] text-dim">
					<Link to="/download" className="hover:text-fg">
						other installers
					</Link>
					<Link to="/login" className="hover:text-fg">
						sign in
					</Link>
					<a href={DOCS} className="hover:text-fg">
						docs
					</a>
				</div>
			</div>
		</div>
	);
}
