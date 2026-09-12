import { viewerEnv } from "@repo/env/viewer";

export const PROXY_PATH = "/ingest";

export interface ReviewTarget {
	key: string;
	surveyId: string;
	uiHost: string;
}

export function reviewTarget(): ReviewTarget | undefined {
	const key = viewerEnv.POSTHOG_KEY;
	const surveyId = viewerEnv.POSTHOG_SURVEY_ID;
	if (!key || !surveyId) return undefined;
	return { key, surveyId, uiHost: viewerEnv.POSTHOG_UI_HOST };
}
