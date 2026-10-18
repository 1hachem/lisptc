import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { LANDING_PAGE_PATH } from "@repo/landing";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FileView } from "../../../../components/file-view.tsx";
import { useVerticalOwner } from "../../../../lib/vertical-owner.ts";

export const Route = createFileRoute("/app/_authed/$workspaceId/landing-page")({
	component: LandingPageFile,
});

function LandingPageFile() {
	const { workspaceId } = Route.useParams();
	const owner = useVerticalOwner();
	const { data: source, error } = useQuery(
		convexQuery(api.files.get, { workspaceId, path: LANDING_PAGE_PATH }),
	);
	if (error) throw error;
	if (!owner)
		return (
			<FileView
				file={undefined}
				missing="a landing page belongs to a vertical, and this account owns none"
			/>
		);

	return (
		<FileView
			file={
				source === undefined
					? undefined
					: { path: LANDING_PAGE_PATH, source: source ?? "" }
			}
			actions={
				<Link
					to="/app/$workspaceId/landing"
					params={{ workspaceId }}
					className="flex-none hover:text-fg"
				>
					preview
				</Link>
			}
		/>
	);
}
