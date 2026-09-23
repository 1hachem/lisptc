import Link from "next/link";
import { Forget } from "@/components/forget.tsx";
import { Empty, Masthead, Pill, Shell, Title } from "@/components/ui.tsx";
import { when } from "@/lib/format.ts";
import { listVersions } from "@/lib/versions.ts";

export const dynamic = "force-dynamic";

export default async function Versions() {
	const versions = await listVersions();

	return (
		<Shell>
			<Masthead>
				<Title>versions</Title>
				<Link className="text-[12px] text-dim hover:text-fg" href="/">
					live views
				</Link>
			</Masthead>

			{versions.length === 0 ? (
				<Empty>
					No versions stored yet. Write one with{" "}
					<span className="text-fg">task dashi-codes:version</span>, then
					compare it against the live repo or against an older one.
				</Empty>
			) : (
				<div className="grid gap-px bg-bg2">
					{versions.map((version, index) => {
						const older = versions[index + 1];
						return (
							<div
								className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 bg-bg1 px-4 py-3"
								key={version.file}
							>
								<span className="text-[13.5px] text-fg">
									{when(version.takenAt)}
								</span>
								<Pill>{version.head}</Pill>
								<span className="flex grow flex-wrap items-center justify-end gap-3 text-[12px]">
									<Link
										className="text-dim hover:text-fg"
										href={`/compare?a=${encodeURIComponent(version.file)}&b=live`}
									>
										against live
									</Link>
									{older === undefined ? null : (
										<Link
											className="text-dim hover:text-fg"
											href={`/compare?a=${encodeURIComponent(older.file)}&b=${encodeURIComponent(version.file)}`}
										>
											against the one before
										</Link>
									)}
									<Forget
										file={version.file}
										kind="version"
										taken={when(version.takenAt)}
									/>
								</span>
							</div>
						);
					})}
				</div>
			)}
		</Shell>
	);
}
