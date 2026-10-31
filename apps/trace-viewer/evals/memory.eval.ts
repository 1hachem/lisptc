import { appliesJudge, openRouterSystemOne } from "@repo/ai";
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

const judged = () => [
	promisesExtension(promisesHost),
	mockedMcpExtension(),
	compactionExtension(compactionHost),
	proseExtension(proseHost),
	memoryExtension({
		...memoryHost,
		store: new VolatileStore(),
		judge: appliesJudge(openRouterSystemOne()),
	}),
];

evalCase(
	"loads the know-how for the user's own machine the moment they ask for it",
	{
		min: 1,
		max: 5,
		extensions: judged,
		mocks: { servers: { playwright } },
		seed: [
			{
				user: "use the browser on my own computer to open hyko.ai and read me the main heading",
			},
		],
		checks: `
(defcheck checks-the-desktop-it-was-only-told-about-by-the-memory
  (eventually (called "desktop-connected-p")))

(defcheck needs-no-recall-to-get-there
  (never (called "memory/recall")))

(defcheck tells-the-user-the-desktop-app-is-needed
  (eventually (answered (matches "[Dd]esktop"))))
`,
	},
);

evalCase("loads nothing about the user's machine for an unrelated question", {
	min: 1,
	max: 3,
	extensions: judged,
	mocks: { servers: { playwright } },
	seed: [{ user: "what is 17 times 23?" }],
	checks: `
(defcheck stays-off-the-desktop
  (never (called "desktop-connected-p")))

(defcheck answers-the-sum
  (eventually (answered (matches "391"))))
`,
});
