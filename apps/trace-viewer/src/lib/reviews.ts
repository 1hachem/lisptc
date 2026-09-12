import { viewerEnv } from "@repo/env/viewer";

export interface ReviewTarget {
	key: string;
	host: string;
	surveyId: string;
}

export function reviewTarget(): ReviewTarget | undefined {
	const key = viewerEnv.POSTHOG_KEY;
	const surveyId = viewerEnv.POSTHOG_SURVEY_ID;
	if (!key || !surveyId) return undefined;
	return { key, surveyId, host: viewerEnv.POSTHOG_HOST };
}
