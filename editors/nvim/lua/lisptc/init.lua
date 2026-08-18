-- Lisptc LSP client setup. Filetype/syntax detection lives in ftdetect/
-- (always sourced, so lazy-loading on `ft = "lisptc"` can even trigger).
-- Formatter and lualine glue live in the host config, since pulling them in
-- from those plugins' specs would force this plugin to load at startup.
local M = {}

function M.setup()
	local config = require("lisptc.lsp")
	config.capabilities = require("cmp_nvim_lsp").default_capabilities()
	vim.lsp.config("lisptc", config)
	vim.lsp.enable("lisptc")
end

return M
