export function tokenPattern(): RegExp {
	return /\s+|("(\\.?|.)*?"|,@?|[^()'`~" \t]+|.)/g;
}
