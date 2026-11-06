import type { FiredMemory, Recognized } from "@repo/journal-catalog/memory";

export const MEMORY_SUBJECT = "memory system";

export function memoryReviewProperties({
	memories,
	recognition,
}: {
	memories: readonly FiredMemory[];
	recognition?: Recognized;
}): Record<string, unknown> {
	return {
		review_subject: MEMORY_SUBJECT,
		memory_keys: memories.map((memory) => memory.key),
		memory_triggers: memories.map((memory) => memory.on ?? "linked"),
		memory_recognized: recognition !== undefined,
		...(recognition === undefined
			? {}
			: {
					recognition_message: recognition.message,
					...(recognition.step === undefined
						? {}
						: { recognition_step: recognition.step }),
					recognition_scores: recognition.scores,
					recognition_fired: (recognition.fired ?? []).map(
						(memory) => memory.key,
					),
					...(recognition.error === undefined
						? {}
						: { recognition_error: recognition.error }),
				}),
	};
}
