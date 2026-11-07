import type { Configuration } from "lint-staged";

export default {
	"*": [
		() => "no-comments --staged --fix",
		"biome format --write --no-errors-on-unmatched",
	],
	"*.ptc": "bash scripts/ptcfmt.sh --write",
} satisfies Configuration;
