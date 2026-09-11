import { evalCase } from "@repo/evals/runner";
import { linear } from "./fixtures/linear.ts";

evalCase("lists its own linear issues and renders them", {
	min: 6,
	max: 12,
	mocks: { servers: { linear } },
	seed: [{ user: "list the issues assigned to me in linear" }],
	checks: `
(defcheck searches-before-loading
  (before (called "load-mcp") (called-any "search-mcps" "list-toolkit")))

(defcheck loads-linear
  (eventually (called "load-mcp" "linear")))

(defcheck awaits-the-connect
  (eventually (awaited "load-mcp")))

(defcheck waits-for-the-load
  (before (called-server "linear") (called "load-mcp")))

(defcheck looks-up-the-tool-before-calling-it
  (before (called-server "linear") (called-any "search-tools" "list-tools")))

(defcheck list-issues-is-the-tool-it-reaches-for
  (requires (without (called-server "linear")
                     (called "linear/list_issues"))
            (called "linear/list_issues")))

(defcheck asks-for-the-issues-assigned-to-me
  (eventually (called "linear/list_issues" :assignee "me")))

(defcheck calls-nothing-that-does-not-exist
  (never (errored)))

(defcheck stays-in-scope
  (never (called-server-other-than "linear")))

(defcheck builds-the-rows-from-the-named-result
  (eventually (called-any "mapcar" "dolist" "assoc" "get-in" "string-join")))

(defcheck prints-the-table-itself
  (after (called "linear/list_issues") (called "echo")))

(defcheck answers-with-a-pointer-not-a-copy
  (never (answered (matches "ENG-1[0-9][0-9]|DES-44|OPS-12|Refresh token rotation|nested quasiquote|Compaction counts|leaks a client|crowds the check column"))))

(defcheck finishes
  (eventually (halted)))
`,
});
