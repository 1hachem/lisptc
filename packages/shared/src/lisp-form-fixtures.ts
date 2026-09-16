export interface FormFixture {
	source: string;
	forms: string[];
	heads: string[];
}

export const FORM_FIXTURES: FormFixture[] = [
	{ source: "The answer is 42.", forms: [], heads: [] },
	{
		source: "Let me square it: (* 5 5)",
		forms: ["(* 5 5)"],
		heads: ["*"],
	},
	{
		source: "an aside (see below)\n(+ 1 2)",
		forms: ["(see below)", "(+ 1 2)"],
		heads: ["see", "+"],
	},
	{
		source: "don't worry about apostrophes (+ 1 2)",
		forms: ["(+ 1 2)"],
		heads: ["+"],
	},
	{
		source: 'prose may hold a lone " quote (+ 1 2)',
		forms: ["(+ 1 2)"],
		heads: ["+"],
	},
	{
		source: 'he said "(foo 1)" and left',
		forms: ["(foo 1)"],
		heads: ["foo"],
	},
	{
		source: 'a remark; with a semicolon, then (echo "") (+ 1 2)',
		forms: ['(echo "")', "(+ 1 2)"],
		heads: ["echo", "+"],
	},
	{
		source: "emoji are prose too 🎉 (+ 1 2)",
		forms: ["(+ 1 2)"],
		heads: ["+"],
	},
	{
		source: '(echo "(not-a-call 1)")',
		forms: ['(echo "(not-a-call 1)")'],
		heads: ["echo"],
	},
	{
		source: '(echo (grep issues "auth"))',
		forms: ['(echo (grep issues "auth"))'],
		heads: ["echo", "grep"],
	},
	{
		source: "the list is '(1 2 3)",
		forms: ["'(1 2 3)"],
		heads: [],
	},
	{
		source: "(echo '(a b))",
		forms: ["(echo '(a b))"],
		heads: ["echo"],
	},
	{
		source: "(setq x 2) quasiquoted: `(1 ,x)",
		forms: ["(setq x 2)", "`(1 ,x)"],
		heads: ["setq"],
	},
	{
		source: "`(1 ,(+ x 2))",
		forms: ["`(1 ,(+ x 2))"],
		heads: ["+"],
	},
];
