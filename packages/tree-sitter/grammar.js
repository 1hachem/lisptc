// Tree-sitter grammar for lisptc (.ptc), used by ptcfmt (see nix/ptcfmt.nix).
//
// It mirrors the reader in packages/interpreter/src/lisp.ts: only the
// parenthesised forms are program text, and everything around them is prose the
// interpreter blanks out (stripProse). Hence `prose` — the dialect has no
// comment syntax, so what sits outside a form is neither a comment nor a run of
// symbols, and `;`, `,`, backticks and quotes out there are ordinary prose
// characters a formatter has no business rewriting. Borrowing a Common-Lisp
// grammar instead, as ptcfmt once did, made all three of those into syntax.

module.exports = grammar({
	name: "lisptc",

	extras: () => [/\s/],

	rules: {
		source: ($) => repeat(choice($.form, $.prose)),

		form: ($) => seq($.open, repeat(choice($.form, $.string, $.atom)), $.close),

		// Reader sugar written directly against the paren belongs to the opener,
		// so a quoted top-level form stays quoted. Folding it into one token is
		// also what makes the lexer agree with stripProse's `startOfForm`: the
		// lexer takes the longest match and a prose word runs greedily up to
		// whitespace, so a comma touching the word before it ("then,(a)") is
		// swallowed as prose, while one that follows whitespace ("then ,(a)") can
		// only be read as this token.
		open: () => token(seq(repeat(/['`,@]/), "(")),
		close: () => ")",

		string: () => token(seq('"', repeat(choice(/[^"\\]/, /\\./)), '"')),

		atom: () => /[^ \t\r\n()"]+/,

		// One node per run of prose, not one per word: the line breaks, blank
		// lines and indentation the author wrote then fall *inside* the node,
		// where a `@leaf` in the Topiary queries keeps them verbatim. `prec.right`
		// picks the greedy split — keep taking words into this run rather than
		// closing it and starting another.
		prose: ($) => prec.right(repeat1($._word)),

		_word: () => /[^()\s]+/,
	},
});
