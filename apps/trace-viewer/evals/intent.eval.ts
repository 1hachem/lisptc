import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { intentExtension } from "@repo/intent-extension";
import { intentHost } from "@repo/intent-extension/host";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { playwright } from "./fixtures/playwright.ts";
import { mockedMcpExtension } from "./harness/mocks.ts";
import { evalCase } from "./harness/runner.ts";

evalCase("says what it does before it reaches out", {
	min: 4,
	max: 12,
	extensions: () => [
		promisesExtension(promisesHost),
		intentExtension(intentHost),
		mockedMcpExtension(),
		compactionExtension(compactionHost),
		proseExtension(proseHost),
	],
	mocks: { servers: { playwright } },
	seed: [{ user: "find what hyko.ai does" }],
	checks: `
(defcheck reaches-out
  (eventually (called-server "playwright")))

(defcheck declares-intent-before-the-first-tool-call
  (before (called-server "playwright") (called "intent/doing")))

(defcheck declares-intent-before-loading-a-server
  (requires (called "load-mcp") (called "intent/doing")))

(defcheck writes-no-broken-forms
  (at-most (errored) 1))
`,
});
