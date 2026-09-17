import { mockedMcpExtension } from "@repo/checks/mocks";
import { evalCase } from "@repo/evals/runner";
import { compactionExtension } from "@repo/interpreter/compaction";
import { memoryExtension, VolatileStore } from "@repo/interpreter/memory";
import { memoryHost } from "@repo/interpreter/memory-host";
import { promisesExtension } from "@repo/interpreter/promises";
import { proseExtension } from "@repo/interpreter/prose";
import { llmHost } from "@repo/llm/llm-host";
import { judgeWith } from "@repo/llm/memory-judge";
import { playwright } from "./fixtures/playwright.ts";

const extensions = () => [
	promisesExtension(),
	mockedMcpExtension(),
	compactionExtension(),
	proseExtension(),
	memoryExtension({ ...memoryHost, store: new VolatileStore() }),
];

const judgedExtensions = () => [
	promisesExtension(),
	mockedMcpExtension(),
	compactionExtension(),
	proseExtension(),
	memoryExtension({
		...memoryHost,
		store: new VolatileStore(),
		judge: judgeWith(llmHost.generate),
	}),
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

evalCase("recalls a memory by meaning when its words do not match", {
	min: 2,
	max: 6,
	extensions: judgedExtensions,
	prelude: `
(memory/remember "sandbox-reset"
  "Anything started after 23:30 loses its work: the environment wipes itself at 00:00 with no warning. Start long tasks earlier in the day.")
`,
	seed: [
		{
			user: "I kicked off a long export just before midnight and it came back empty. Why would that happen?",
		},
	],
	checks: `
(defcheck retrieves-the-memory
  (eventually (called "memory/recall")))

(defcheck answers-from-the-recalled-fact
  (eventually (answered (matches "wipe|reset|00:00|23:30"))))

(defcheck runs-without-an-error
  (never (errored)))
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
