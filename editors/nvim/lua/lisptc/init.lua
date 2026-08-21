-- Lisptc LSP client setup. Filetype/syntax detection lives in ftdetect/
-- (always sourced, so lazy-loading on `ft = "lisptc"` can even trigger).
-- Formatter and lualine glue live in the host config, since pulling them in
-- from those plugins' specs would force this plugin to load at startup.
local SESSION = require("lisptc.session")

local M = {}

function M.setup()
	local config = require("lisptc.lsp")
	config.capabilities = require("cmp_nvim_lsp").default_capabilities()
	vim.lsp.config("lisptc", config)
	vim.lsp.enable("lisptc")

	-- The shared session (lsp.lua + repl.lua) is a detached background
	-- process that otherwise outlives nvim indefinitely. Kill it on quit so it
	-- doesn't linger as an orphan; `vim.fn.system` blocks so this finishes
	-- before nvim actually exits.
	vim.api.nvim_create_autocmd("VimLeavePre", {
		once = true,
		callback = function()
			vim.fn.system({
				"node",
				"--no-warnings",
				"--experimental-transform-types",
				vim.fn.expand("~/lisptc/packages/repl/src/cli.ts"),
				"--kill",
				SESSION,
			})
		end,
	})
end

return M
