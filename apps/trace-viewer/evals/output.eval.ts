import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { playwright } from "./fixtures/playwright.ts";
import { mockedMcpExtension } from "./harness/mocks.ts";
import { evalCase } from "./harness/runner.ts";

evalCase("acts through forms and answers in prose, never in tool-call markup", {
	min: 3,
	max: 12,
	extensions: () => [
		promisesExtension(promisesHost),
		mockedMcpExtension(),
		compactionExtension(compactionHost),
		proseExtension(proseHost),
	],
	mocks: { servers: { playwright } },
	seed: [{ user: "open hyko.ai and tell me what the company does" }],
	checks: `
(defcheck acts-through-forms
  (eventually (called-server "playwright")))

(defcheck answers-without-markup
  (never (answered (matches "<[A-Za-z/][^>]*>"))))
`,
});
