export const ENVIRONMENTS = ["dev", "staging", "prod"] as const;

export function serviceName(service: string, environment: string): string {
	return `${service}-${environment}`;
}
