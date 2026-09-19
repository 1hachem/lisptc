import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

vi.stubEnv("LISPTC_MEMORY_DIR", mkdtempSync(join(tmpdir(), "lisptc-memory-")));
vi.stubEnv("DO_API_KEY", "stub");
vi.stubEnv("LLM_PROVIDER", "digitalocean");
