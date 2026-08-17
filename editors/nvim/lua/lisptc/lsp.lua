local SESSION = require("lisptc.session")

return {
	cmd = {
		"env",
		"LISPTC_SESSION=" .. SESSION,
		"node",
		"--no-warnings",
		"--experimental-transform-types",
		vim.fn.expand("~/lisptc/apps/lsp/src/server.ts"),
		"--stdio",
	},
	filetypes = { "lisptc" },
	root_markers = { ".git" },
	handlers = {
		["lisptc/mcpsChanged"] = function(_, result)
			require("lisptc.mcps").set(result.mcps)
		end,
	},
}
