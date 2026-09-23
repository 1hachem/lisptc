import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { VolatileStore } from "@repo/memory-extension/ports";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { playwright } from "./fixtures/playwright.ts";
import { mockedMcpExtension } from "./harness/mocks.ts";
import { evalCase } from "./harness/runner.ts";

const extensions = () => [
	promisesExtension(promisesHost),
	mockedMcpExtension(),
	compactionExtension(compactionHost),
	proseExtension(proseHost),
	memoryExtension({ ...memoryHost, store: new VolatileStore() }),
];

evalCase("navigates with the tool name a memory handed it", {
	min: 3,
	max: 7,
	extensions,
	mocks: { servers: { playwright } },
	prelude: `
(memory/remember "playwright navigate"
  "playwright navigates with browser_navigate, not navigate: (playwright/browser_navigate :url \\"https://example.com\\"). Every tool on this server is named browser_something, so a bare verb is always wrong."
  :on '(call (load-mcp "playwright")))
`,
	seed: [
		{ user: "open hyko.ai and tell me the main heading" },
		{
			assistant: `I need a browser. Let me see what the toolkit has.
(search-mcps "browser")`,
		},
		{
			assistant: `playwright drives a real browser, so I will load it.
(await (load-mcp "playwright"))`,
		},
	],
	checks: `
(defcheck navigates-with-the-remembered-name
  (eventually (called "playwright/browser_navigate" :url (matches "hyko\\\\.ai"))))

(defcheck never-guesses-the-short-name
  (never (called "playwright/navigate")))

(defcheck takes-the-memory-at-its-word
  (never (called-any "list-tools" "search-tools")))

(defcheck runs-without-an-error
  (never (errored)))

(defcheck answers-with-the-heading
  (eventually (answered (matches "Build AI workflows"))))
`,
});

evalCase("writes the correction down the moment a guess fails", {
	min: 4,
	max: 10,
	extensions,
	mocks: { servers: { playwright } },
	seed: [
		{ user: "open hyko.ai and tell me the main heading" },
		{
			assistant: `playwright drives a real browser, so I will load it.
(await (load-mcp "playwright"))`,
		},
		{
			assistant: `Now I will navigate to the site.
(playwright/navigate :url "https://hyko.ai")`,
		},
	],
	checks: `
(defcheck looks-the-name-up-after-the-miss
  (after (errored) (called-any "list-tools" "search-tools")))

(defcheck remembers-the-correction-on-the-load
  (eventually (called "memory/remember" :on (any))))

(defcheck recovers-with-the-real-name
  (eventually (called "playwright/browser_navigate" :url (matches "hyko\\\\.ai"))))

(defcheck does-not-guess-the-same-name-twice
  (at-most (called "playwright/navigate") 1))

(defcheck answers-with-the-heading
  (eventually (answered (matches "Build AI workflows"))))
`,
});
