export interface ValidationIssue {
	readonly message: string;
	readonly path?: readonly unknown[];
}

export function issueName(issue: ValidationIssue): string {
	const segment = issue.path?.[0];
	if (typeof segment === "string") return segment;
	if (
		segment &&
		typeof segment === "object" &&
		"key" in segment &&
		typeof segment.key === "string"
	) {
		return segment.key;
	}
	return issue.message;
}

export function invalid(area: string) {
	return (issues: readonly ValidationIssue[]): never => {
		const named = issues.map(
			(issue) => `${issueName(issue)}: ${issue.message}`,
		);
		throw new Error(`invalid ${area} environment — ${named.join("; ")}`);
	};
}
