import { traceViewerEnv } from "@repo/env/trace-viewer";

export const PROXY_PATH = "/ingest";

export interface ReviewTarget {
	key: string;
	surveyId: string;
	uiHost: string;
	environment: string;
}

export function reviewTarget(): ReviewTarget | undefined {
	const key = traceViewerEnv.NEXT_PUBLIC_POSTHOG_KEY;
	const surveyId = traceViewerEnv.NEXT_PUBLIC_POSTHOG_SURVEY_ID;
	if (!key || !surveyId) return undefined;
	return {
		key,
		surveyId,
		uiHost: traceViewerEnv.POSTHOG_UI_HOST,
		environment: traceViewerEnv.NEXT_PUBLIC_ENVIRONMENT,
	};
}
