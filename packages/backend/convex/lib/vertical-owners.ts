export function verticalOwnerEmails(list: string | undefined): string[] {
	return (list ?? "")
		.split(/[\s,]+/)
		.map((email) => email.trim().toLowerCase())
		.filter((email) => email !== "");
}

export function seededVerticalOwner(
	account: { email: string; emailVerified: boolean },
	list: string | undefined,
): boolean {
	return (
		account.emailVerified &&
		verticalOwnerEmails(list).includes(account.email.toLowerCase())
	);
}
