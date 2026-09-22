import { defaultJudge, judgeSpecs } from "@repo/env/providers";
import {
	DEFAULT_JUDGE,
	defineJudge,
	isJudgeName,
	type Judge,
	type JudgeName,
	type JudgeReport,
	judgeReports,
	judgeSpecFor,
} from "@repo/shared/judge";

function selected(): JudgeName {
	return isJudgeName(defaultJudge) ? defaultJudge : DEFAULT_JUDGE;
}

export const judges: Record<JudgeName, Judge> = {
	jev: defineJudge(judgeSpecs.jev),
	openrouter: defineJudge(judgeSpecs.openrouter),
};

export function getJudge(name: JudgeName = selected()): Judge {
	return defineJudge(judgeSpecFor(name, judgeSpecs));
}

export function listJudges(): JudgeReport[] {
	return judgeReports(judgeSpecs, selected());
}
