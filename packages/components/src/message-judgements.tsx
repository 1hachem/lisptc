"use client";

export function MessageJudgements({
	scores,
	firesAt,
	error,
}: {
	scores: Record<string, number>;
	firesAt?: number;
	error?: string;
}) {
	const rows = Object.entries(scores).sort(([, a], [, b]) => b - a);
	if (rows.length === 0 && error === undefined) return null;

	return (
		<div className="mt-1 flex select-none flex-col gap-0.5 text-[11px] text-dim leading-[1.7]">
			{error !== undefined && (
				<div className="min-w-0 break-words text-red">
					judge failed: {error}
				</div>
			)}
			{rows.map(([pattern, score]) => {
				const fires = firesAt !== undefined && score >= firesAt;
				return (
					<div
						key={pattern}
						className="flex min-w-0 items-baseline gap-1.5 break-words"
						title={
							firesAt === undefined
								? undefined
								: fires
									? `crossed ${firesAt}`
									: `below ${firesAt}`
						}
					>
						<span className="tabular-nums">{score.toFixed(2)}</span>
						<span className={fires ? "text-fg" : undefined}>{pattern}</span>
						{fires ? <span className="text-green">fires</span> : null}
					</div>
				);
			})}
		</div>
	);
}
