local SESSION = require("lisptc.session")

-- Iron REPL definition for lisptc buffers, wired in from the host config's
-- plugins/iron.lua (repl_definition.lisptc = require("lisptc.repl")).
-- --silent suppresses pnpm's script-runner echo (propagates to the nested --filter call).
-- repl:attach + LISPTC_SESSION share one interpreter with the lisptc LSP
-- so defs typed here show up in completion/hover.
-- LISPTC_OWNER_PID ties a freshly-spawned session server to this nvim process,
-- so it exits (and deletes its socket) once nvim closes instead of lingering.
return {
	command = {
		"env",
		"LISPTC_SESSION=" .. SESSION,
		"LISPTC_OWNER_PID=" .. vim.fn.getpid(),
		"pnpm",
		"--silent",
		"-C",
		vim.fn.expand("~/lisptc"),
		"run",
		"repl:attach",
	},
	format = require("iron.fts.common").bracketed_paste,
}
