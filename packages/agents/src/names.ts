export const DELEGATE_PREFIX = "delegate-";

export function onRoster(
	roster: readonly string[] | undefined,
	name: string,
): boolean {
	return roster === undefined || roster.includes(name);
}

export function isDelegateName(name: string): boolean {
	return name.startsWith(DELEGATE_PREFIX);
}

export function delegateName(taken: readonly string[]): string {
	const held = new Set(taken);
	let n = 1;
	while (held.has(`${DELEGATE_PREFIX}${n}`)) n += 1;
	return `${DELEGATE_PREFIX}${n}`;
}
