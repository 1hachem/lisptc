// Documentation for the language's special forms, built-ins, and prelude
// definitions, keyed by binding name. Kept separate from lisp.ts so tooling
// (the LSP server, help commands) can import it without pulling anything else.

export interface Doc {
	signature: string;
	doc: string;
}

export const docs: Record<string, Doc> = {
	// Special forms (keywords handled directly by the evaluator; these are not
	// global bindings but are part of the language).
	quote: {
		signature: "(quote x)",
		doc: "Return `x` unevaluated. `'x` is shorthand.",
	},
	progn: {
		signature: "(progn expr...)",
		doc: "Evaluate the expressions in order; return the last value.",
	},
	cond: {
		signature: "(cond (test expr...)...)",
		doc: "Evaluate each `test` in turn; for the first non-nil one, evaluate its body and return the last value (or the test's value if the body is empty). Returns nil if no test passes.",
	},
	setq: {
		signature: "(setq name value...)",
		doc: "Assign each `value` to the (global or lexical) variable `name`; return the last value.",
	},
	lambda: {
		signature: "(lambda (arg...) body...)",
		doc: "Create an anonymous function. The argument list may end with `&rest name` to collect remaining arguments as a list.",
	},
	macro: {
		signature: "(macro (arg...) body...)",
		doc: "Create a macro (only at the top level). Prefer `defmacro`.",
	},

	// Built-in functions (defined in lisp.ts).
	car: {
		signature: "(car list)",
		doc: "Return the first element of `list`, or nil for nil.",
	},
	cdr: {
		signature: "(cdr list)",
		doc: "Return the rest of `list` after the first element, or nil for nil.",
	},
	cons: {
		signature: "(cons x y)",
		doc: "Return a new cons cell with `x` as car and `y` as cdr.",
	},
	atom: {
		signature: "(atom x)",
		doc: "Return t if `x` is not a cons cell (i.e. not a non-empty list).",
	},
	eq: {
		signature: "(eq x y)",
		doc: "Return t if `x` and `y` are the same object (identity).",
	},
	list: {
		signature: "(list x...)",
		doc: "Return a new list of the given elements.",
	},
	rplaca: {
		signature: "(rplaca cell x)",
		doc: "Destructively set the car of `cell` to `x`; return `x`. Alias: `setcar`.",
	},
	rplacd: {
		signature: "(rplacd cell x)",
		doc: "Destructively set the cdr of `cell` to `x`; return `x`. Alias: `setcdr`.",
	},
	length: {
		signature: "(length x)",
		doc: "Return the length of a list or string.",
	},
	stringp: {
		signature: "(stringp x)",
		doc: "Return t if `x` is a string.",
	},
	numberp: {
		signature: "(numberp x)",
		doc: "Return t if `x` is a number.",
	},
	eql: {
		signature: "(eql x y)",
		doc: "Return t if `x` and `y` are identical or numerically equal. Alias: `=`.",
	},
	"<": {
		signature: "(< x y)",
		doc: "Return t if `x` is numerically less than `y`.",
	},
	"%": {
		signature: "(% x y)",
		doc: "Return the remainder of `x` divided by `y`. Alias: `rem`.",
	},
	mod: {
		signature: "(mod x y)",
		doc: "Return `x` modulo `y` (result has the sign of `y`).",
	},
	"+": {
		signature: "(+ x...)",
		doc: "Return the sum of the arguments (0 with no arguments).",
	},
	"*": {
		signature: "(* x...)",
		doc: "Return the product of the arguments (1 with no arguments).",
	},
	"-": {
		signature: "(- x y...)",
		doc: "Subtract the rest from `x`; with one argument, negate it.",
	},
	"/": {
		signature: "(/ x y...)",
		doc: "Divide `x` by the remaining arguments.",
	},
	truncate: {
		signature: "(truncate x [y])",
		doc: "Return `x` (or `x`/`y`) truncated toward zero to an integer.",
	},
	prin1: {
		signature: "(prin1 x)",
		doc: "Print `x` in re-readable form (strings quoted); return `x`.",
	},
	princ: {
		signature: "(princ x)",
		doc: "Print `x` in human-readable form (strings unquoted); return `x`.",
	},
	terpri: {
		signature: "(terpri)",
		doc: "Print a newline; return t.",
	},
	help: {
		signature: "(help)",
		doc: "Print the REPL usage text.",
	},
	"*gensym-counter*": {
		signature: "*gensym-counter*",
		doc: "Counter used by `gensym` to name fresh symbols.",
	},
	gensym: {
		signature: "(gensym)",
		doc: "Return a new uninterned symbol (G1, G2, ...).",
	},
	"make-symbol": {
		signature: "(make-symbol name)",
		doc: "Return a new uninterned symbol named `name`.",
	},
	intern: {
		signature: "(intern name)",
		doc: "Return the interned symbol named `name`.",
	},
	"symbol-name": {
		signature: "(symbol-name sym)",
		doc: "Return the name of `sym` as a string.",
	},
	apply: {
		signature: "(apply f args)",
		doc: "Call `f` with the elements of the list `args` as its arguments.",
	},
	exit: {
		signature: "(exit code)",
		doc: "Exit the process with the given status code.",
	},
	dump: {
		signature: "(dump)",
		doc: "Return a list of all global symbols.",
	},
	"*version*": {
		signature: "*version*",
		doc: "The interpreter version: (number implementation-language name).",
	},

	// MCP built-ins (defined in mcp.ts).
	"load-mcp": {
		signature: '(load-mcp "server" [:config "path"])',
		doc: "Load an MCP server from the config file; each of its tools becomes a global function named `server/tool` called with keyword arguments.",
	},
	"unload-mcp": {
		signature: '(unload-mcp "server")',
		doc: "Unload an MCP server and remove its `server/tool` bindings.",
	},
	"list-mcps": {
		signature: "(list-mcps)",
		doc: "Return the list of currently loaded MCP servers.",
	},
	"list-tools": {
		signature: '(list-tools ["server"])',
		doc: "Return the tools of all loaded MCP servers (or one server).",
	},
	"mcp-doc": {
		signature: '(mcp-doc "server/tool")',
		doc: "Return the documentation (description and input schema) of an MCP tool.",
	},
	"search-tools": {
		signature: '(search-tools "query")',
		doc: "Search the tools of all loaded MCP servers by name/description.",
	},
	"mcp-shutdown": {
		signature: "(mcp-shutdown)",
		doc: "Shut down the MCP broker worker and unload all servers.",
	},

	// Prelude definitions (Lisp source in lisp.ts).
	defmacro: {
		signature: "(defmacro name (arg...) body...)",
		doc: "Define a global macro named `name`.",
	},
	defun: {
		signature: "(defun name (arg...) body...)",
		doc: "Define a global function named `name`. Use `&rest` for variadic arguments.",
	},
	caar: { signature: "(caar x)", doc: "(car (car x))" },
	cadr: {
		signature: "(cadr x)",
		doc: "(car (cdr x)) — the second element of a list.",
	},
	cdar: { signature: "(cdar x)", doc: "(cdr (car x))" },
	cddr: { signature: "(cddr x)", doc: "(cdr (cdr x))" },
	caaar: { signature: "(caaar x)", doc: "(car (car (car x)))" },
	caadr: { signature: "(caadr x)", doc: "(car (car (cdr x)))" },
	cadar: { signature: "(cadar x)", doc: "(car (cdr (car x)))" },
	caddr: {
		signature: "(caddr x)",
		doc: "(car (cdr (cdr x))) — the third element of a list.",
	},
	cdaar: { signature: "(cdaar x)", doc: "(cdr (car (car x)))" },
	cdadr: { signature: "(cdadr x)", doc: "(cdr (car (cdr x)))" },
	cddar: { signature: "(cddar x)", doc: "(cdr (cdr (car x)))" },
	cdddr: { signature: "(cdddr x)", doc: "(cdr (cdr (cdr x)))" },
	not: {
		signature: "(not x)",
		doc: "Return t if `x` is nil. Alias: `null`.",
	},
	consp: {
		signature: "(consp x)",
		doc: "Return t if `x` is a cons cell (a non-empty list).",
	},
	print: {
		signature: "(print x)",
		doc: "Print `x` via prin1 followed by a newline; return `x`.",
	},
	identity: {
		signature: "(identity x)",
		doc: "Return `x` unchanged.",
	},
	"=": {
		signature: "(= x y)",
		doc: "Return t if `x` and `y` are numerically equal (alias of `eql`).",
	},
	rem: {
		signature: "(rem x y)",
		doc: "Return the remainder of `x` divided by `y` (alias of `%`).",
	},
	null: {
		signature: "(null x)",
		doc: "Return t if `x` is nil (alias of `not`).",
	},
	setcar: {
		signature: "(setcar cell x)",
		doc: "Destructively set the car of `cell` to `x` (alias of `rplaca`).",
	},
	setcdr: {
		signature: "(setcdr cell x)",
		doc: "Destructively set the cdr of `cell` to `x` (alias of `rplacd`).",
	},
	">": {
		signature: "(> x y)",
		doc: "Return t if `x` is numerically greater than `y`.",
	},
	">=": {
		signature: "(>= x y)",
		doc: "Return t if `x` is greater than or equal to `y`.",
	},
	"<=": {
		signature: "(<= x y)",
		doc: "Return t if `x` is less than or equal to `y`.",
	},
	"/=": {
		signature: "(/= x y)",
		doc: "Return t if `x` and `y` are not numerically equal.",
	},
	equal: {
		signature: "(equal x y)",
		doc: "Return t if `x` and `y` are structurally equal (recursing into lists).",
	},
	if: {
		signature: "(if test then else...)",
		doc: "If `test` is non-nil, evaluate `then`; otherwise evaluate the `else` forms.",
	},
	when: {
		signature: "(when test body...)",
		doc: "If `test` is non-nil, evaluate `body` and return its last value.",
	},
	let: {
		signature: "(let ((name value)...) body...)",
		doc: "Bind variables in parallel, then evaluate `body`. A bare `name` binds to nil.",
	},
	letrec: {
		signature: "(letrec ((name value)...) body...)",
		doc: "Like `let`, but bindings may refer to each other (e.g. for local recursive functions).",
	},
	append: {
		signature: "(append list...)",
		doc: "Return the concatenation of the given lists (copies all but the last).",
	},
	and: {
		signature: "(and x...)",
		doc: "Evaluate left to right; return nil on the first nil value, else the last value.",
	},
	mapcar: {
		signature: "(mapcar f list)",
		doc: "Return a new list of `f` applied to each element of `list`.",
	},
	or: {
		signature: "(or x...)",
		doc: "Evaluate left to right; return the first non-nil value, else nil.",
	},
	listp: {
		signature: "(listp x)",
		doc: "Return t if `x` is a list (nil or a cons cell).",
	},
	memq: {
		signature: "(memq key list)",
		doc: "Return the tail of `list` whose car is `eq` to `key`, or nil.",
	},
	member: {
		signature: "(member key list)",
		doc: "Return the tail of `list` whose car is `equal` to `key`, or nil.",
	},
	assq: {
		signature: "(assq key alist)",
		doc: "Return the first pair of `alist` whose car is `eq` to `key`, or nil.",
	},
	assoc: {
		signature: "(assoc key alist)",
		doc: "Return the first pair of `alist` whose car is `equal` to `key`, or nil.",
	},
	nreverse: {
		signature: "(nreverse list)",
		doc: "Reverse `list` destructively; return the reversed list.",
	},
	last: {
		signature: "(last list)",
		doc: "Return the last cons cell of `list`.",
	},
	nconc: {
		signature: "(nconc list...)",
		doc: "Concatenate the lists destructively; return the result.",
	},
	while: {
		signature: "(while test body...)",
		doc: "Loop: evaluate `body` while `test` is non-nil; return nil.",
	},
	dolist: {
		signature: "(dolist (name list [result]) body...)",
		doc: "Evaluate `body` with `name` bound to each element of `list`; return `result` (default nil).",
	},
	dotimes: {
		signature: "(dotimes (name count [result]) body...)",
		doc: "Evaluate `body` with `name` bound to 0..count-1; return `result` (default nil).",
	},
	t: { signature: "t", doc: "The canonical true value." },
	nil: { signature: "nil", doc: "The empty list / false value." },
};
