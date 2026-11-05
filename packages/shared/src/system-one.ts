export type Judgment =
	| { type: "noul"; instructions: string }
	| {
			type: "choice";
			instructions: string;
			criteria: Record<string, string | null>;
	  }
	| { type: "score"; instructions: string; criteria: string[] };

export type Verdict =
	| { type: "noul"; noul: number }
	| {
			type: "choice";
			choice: string;
			confidence: number;
			probabilities: Record<string, number>;
	  }
	| { type: "score"; score: number; confidence: number };

export interface JudgeRequest {
	state: unknown;
	questions: Record<string, Judgment>;
	model?: string;
}

export interface JudgeResult {
	answers: Record<string, Verdict>;
	model: string;
}

export interface SystemOneModel {
	readonly provider: string;
	readonly model: string;
	judge(req: JudgeRequest, signal?: AbortSignal): Promise<JudgeResult>;
}
