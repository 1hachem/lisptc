import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.LISPTC_MEMORY_DIR = mkdtempSync(join(tmpdir(), "lisptc-memory-"));
process.env.LISPTC_JUDGE = "off";
