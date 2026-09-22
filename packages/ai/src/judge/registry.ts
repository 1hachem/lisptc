import { defaultJudge, judgeSpecs } from "@repo/env/providers";
import {
	defineJudge,
	type Judge,
	type JudgeName,
	type JudgeReport,
	judgeReports,
	judgeSpecFor,
} from "@repo/shared/judge";

export const judges: Record<JudgeName, Judge> = {
	typesafe: defineJudge(judgeSpecs.typesafe),
	openrouter: defineJudge(judgeSpecs.openrouter),
};

export function getJudge(name: JudgeName = defaultJudge): Judge {
	return defineJudge(judgeSpecFor(name, judgeSpecs));
}

export function listJudges(): JudgeReport[] {
	return judgeReports(judgeSpecs, defaultJudge);
}
