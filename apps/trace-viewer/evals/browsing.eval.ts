import { evalCase } from "@repo/evals/runner";
import { playwright } from "./fixtures/playwright.ts";

evalCase("navigates to hyko.ai by the book", {
	min: 5,
	max: 12,
	mocks: { servers: { playwright } },
	seed: [{ user: "navigate to hyko.ai" }],
	checks: `
(defcheck searches-before-loading
  (before (called "load-mcp") (called "search-mcps")))

(defcheck looks-up-tools-before-navigating
  (before (called "playwright/browser_navigate")
          (called-any "list-tools" "search-tools")))

(defcheck navigate-is-the-first-tool-it-reaches-for
  (requires (without (called-server "playwright")
                     (called "playwright/browser_navigate"))
            (called "playwright/browser_navigate")))

(defcheck navigates-to-the-site
  (eventually (called "playwright/browser_navigate" :url (matches "hyko\\\\.ai"))))

(defcheck calls-nothing-that-does-not-exist
  (never (errored)))

(defcheck stops
  (within 12 (halted)))
`,
});

evalCase("finds a browser, loads it, and opens the page", {
	min: 4,
	max: 10,
	mocks: { servers: { playwright } },
	seed: [{ user: "open hyko.ai and tell me the main heading" }],
	checks: `
(defcheck finds-the-server
  (before (called "load-mcp") (called-any "search-mcps" "list-toolkit")))

(defcheck waits-for-the-load
  (before (called-server "playwright") (called "load-mcp")))

(defcheck opens-the-site
  (eventually (called "playwright/browser_navigate" :url (matches "hyko\\\\.ai"))))

(defcheck stays-in-scope
  (never (called-server-other-than "playwright")))

(defcheck writes-no-broken-forms
  (never (errored)))

(defcheck stops
  (within 10 (halted)))
`,
});

evalCase("recovers when the server it wants will not connect", {
	min: 3,
	max: 10,
	mocks: {
		servers: { playwright: { tools: [], fails: "chromium is not installed" } },
	},
	seed: [{ user: "open hyko.ai and tell me the main heading" }],
	checks: `
(defcheck tries-the-browser
  (eventually (called "load-mcp" "playwright")))

(defcheck does-not-keep-retrying
  (at-most (called "load-mcp" "playwright") 3))

(defcheck says-it-could-not
  (eventually (halted)))

(defcheck stops
  (within 10 (halted)))
`,
});
