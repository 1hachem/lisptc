const RESTORE_FAILURES: Record<string, string> = {
	NO_SUCH_FILE: "it is no longer in the bin",
	TOO_MANY_FILES: "its folder is full",
	NAME_TAKEN: "its folder holds too many files of that name",
};

export function restoreFailure(code: string | undefined): string {
	return (code && RESTORE_FAILURES[code]) || code || "restore failed";
}
