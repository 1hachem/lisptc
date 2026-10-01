#!/usr/bin/env node
import { main } from "@earendil-works/pi-coding-agent";
import lisptc from "./extension.ts";

await main(process.argv.slice(2), {
	extensionFactories: [{ name: "lisptc", factory: lisptc }],
});
