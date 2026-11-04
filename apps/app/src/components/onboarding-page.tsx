import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { onboardingSource } from "../lib/files.ts";
import { FileView } from "./file-view.tsx";

export function OnboardingPage({
	workspaceId,
	name,
}: {
	workspaceId: Id<"workspaces">;
	name: string;
}) {
	const { data: onboardings, error } = useQuery(
		convexQuery(api.onboardings.list, { workspaceId }),
	);
	if (error) throw error;
	const onboarding = onboardings?.find((candidate) => candidate.name === name);

	return (
		<FileView
			file={
				onboarding && {
					path: `onboarding/${name}`,
					source: onboardingSource(onboarding),
				}
			}
			missing={
				onboardings === undefined ? undefined : `no onboarding named ${name}`
			}
		/>
	);
}
