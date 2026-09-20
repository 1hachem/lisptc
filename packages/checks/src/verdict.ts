export type Verdict = "true" | "false" | "pending";

export interface CheckOutcome {
	name: string;
	verdict: Verdict;
	step?: number;
}
