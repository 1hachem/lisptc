/*
 * Lisptc — derived from Nukata Lisp 2.1.0 in TypeScript by SUZUKI Hisao.
 *
 * Public entry point of the interpreter, re-exporting its modules:
 *   sexpr.ts      cons cells, symbols, keywords, interning
 *   printer.ts    str() — printed representations
 *   exceptions.ts EvalException and friends
 *   schemas.ts    zod argument schemas for built-ins
 *   func.ts       lambdas, closures, macros, built-in functions
 *   compile.ts    argument compilation and quasi-quotation
 *   interp.ts     the Interp evaluator core
 *   builtins.ts   native built-in registration
 *   reader.ts     the tokenizer/parser
 *   prelude.ts    the Lisp prelude (src/prelude.ptc)
 *   repl.ts       run(), checkSyntax(), ReplSession, createInterp()
 *   mcp/          the MCP integration (bridge, broker, adapters)
 *   main.ts       the standalone Node REPL (`pnpm repl`)
 */
export { EndOfFile, EvalException } from "./exceptions.ts";
export { type Doc, formatSignature, Interp } from "./interp.ts";
export { setWriter } from "./io.ts";
export { prelude } from "./prelude.ts";
export { str } from "./printer.ts";
export { Reader } from "./reader.ts";
export {
	checkSyntax,
	createInterp,
	ReplSession,
	run,
	type SyntaxError_,
} from "./repl.ts";
export { zAny, zList } from "./schemas.ts";
export {
	Cell,
	LispKeyword,
	type List,
	newLispKeyword,
	newSym,
	Sym,
} from "./sexpr.ts";
