export type Thumb = "up" | "down";

export interface Review {
	thumb: Thumb;
	submissionId: string;
	text?: string;
}

const RESPONSE: Record<Thumb, number> = { up: 1, down: 2 };

const POSITIVE_MESSAGES = [
	"thanks for the nice words",
	"thanks",
	"maaa man",
	"you're too kind",
	"i'll be here all week",
	"flattery will get you everywhere",
	"much obliged, friend",
	"you really know how to make a bot blush",
];

const NEGATIVE_MESSAGES = [
	"sorry about that",
	"copy that sir",
	"my bad, fixing my circuits",
	"i'll do better next time",
	"back to the drawing board",
	"noted, working on it",
	"rough day at the office",
	"i'll blame my training data",
	"oops, that was my evil twin",
];

export function surveyResponse(review: Review): Record<string, unknown> {
	return {
		$survey_response: RESPONSE[review.thumb],
		$survey_submission_id: review.submissionId,
		$survey_completed: true,
		...(review.text
			? { $survey_response_1: review.text, review_text: review.text }
			: {}),
	};
}

export function quip(thumb: Thumb): string {
	const lines = thumb === "up" ? POSITIVE_MESSAGES : NEGATIVE_MESSAGES;
	return lines[Math.floor(Math.random() * lines.length)];
}
