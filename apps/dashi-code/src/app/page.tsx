import Link from "next/link";
import { Atlas } from "@/components/atlas.tsx";
import { Live } from "@/components/live.tsx";
import { Masthead, Shell, Title } from "@/components/ui.tsx";
import { snapshot } from "@/lib/snapshot.ts";

export const dynamic = "force-dynamic";

export default async function Views() {
	const view = await snapshot();

	return (
		<Shell>
			<Masthead>
				<Title>views of this repo</Title>
				<div className="flex flex-wrap items-center gap-3">
					<Live generated={view.generated} head={view.head} />
					<Link className="text-[12px] text-dim hover:text-fg" href="/pulls">
						pull requests
					</Link>
					<Link className="text-[12px] text-dim hover:text-fg" href="/versions">
						versions
					</Link>
				</div>
			</Masthead>
			<Atlas view={view} />
		</Shell>
	);
}
