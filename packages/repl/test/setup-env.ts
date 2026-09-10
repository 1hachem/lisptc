import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const file = join(mkdtempSync(join(tmpdir(), "lisptc-secrets-")), ".env");
writeFileSync(file, "REPL_PI_TOKEN=t0ken\n");
process.env.LISPTC_SECRETS_FILE = file;
