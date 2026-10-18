import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { LANDING_PAGE_PATH } from "@repo/landing";
import { LandingView } from "@repo/landing-components";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { readLandingSource, startHref } from "../../../lib/site-pages.ts";

export const Route = createFileRoute("/_authed/$workspaceId/landing")({
	component: LandingPreview,
});

function Notice({ title, lines }: { title: string; lines: readonly string[] }) {
	return (
		<div className="flex flex-col gap-2 p-4 text-sm">
			<p className="text-fg">{title}</p>
			<ul className="flex flex-col gap-1 text-dim">
				{lines.map((line) => (
					<li key={line}>{line}</li>
				))}
			</ul>
		</div>
	);
}

function LandingPreview() {
	const { workspaceId } = Route.useParams();
	const { data: source } = useQuery(
		convexQuery(api.files.get, { workspaceId, path: LANDING_PAGE_PATH }),
	);
	if (source === undefined) return null;
	if (source === null)
		return (
			<Notice
				title={`no ${LANDING_PAGE_PATH} in this workspace yet`}
				lines={["ask the agent to write one, and it shows here as it changes"]}
			/>
		);
	const read = readLandingSource(source);
	if (!read.ok)
		return (
			<Notice
				title={`${LANDING_PAGE_PATH} does not fit the landing page schema`}
				lines={read.problems}
			/>
		);
	return (
		<div className="h-full overflow-y-auto">
			<LandingView page={read.page} start={startHref} />
		</div>
	);
}
