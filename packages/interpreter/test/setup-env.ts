import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.LISPTC_OAUTH_DIR = mkdtempSync(join(tmpdir(), "lisptc-oauth-"));
