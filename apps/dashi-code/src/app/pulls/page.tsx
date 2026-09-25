import Link from "next/link";
import { PullsAtlas } from "@/components/pulls.tsx";
import { SpanPicker } from "@/components/span.tsx";
import { Empty, Masthead, Pill, Shell, Title } from "@/components/ui.tsx";
import { when } from "@/lib/format.ts";
import { readPulls } from "@/lib/pulls.ts";
import { narrow, spanOf } from "@/lib/span.ts";

export const dynamic = "force-dynamic";

export default async function PullRequests({
	searchParams,
}: {
	searchParams: Promise<{ span?: string }>;
}) {
	const [view, params] = await Promise.all([readPulls(), searchParams]);
	const span = spanOf(params.span);

	return (
		<Shell>
			<Masthead>
				<Title>pull requests</Title>
				<div className="flex flex-wrap items-center gap-3">
					<SpanPicker at="/pulls" current={span.id} />
					{view === null ? null : (
						<Pill>
							{view.forge} · read {when(view.generated)}
						</Pill>
					)}
					<Link className="text-[12px] text-dim hover:text-fg" href="/">
						live views
					</Link>
				</div>
			</Masthead>

			{view === null ? (
				<Empty>
					No forge document stored yet. The analysis writes one, so hit{" "}
					<span className="text-fg">refresh</span> on the views page. If it
					keeps failing, the forge reader says why there.
				</Empty>
			) : (
				<PullsAtlas span={span} view={narrow(view, span)} />
			)}
		</Shell>
	);
}
