export type {
	Answer,
	Judge,
	Judged,
	JudgeName,
	JudgeReport,
	JudgeRequest,
	Question,
} from "@repo/shared/judge";
export { choice, noul, score } from "@repo/shared/judge";
export { getJudge, judges, listJudges } from "./judge/registry.ts";
