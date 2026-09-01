-- Always sourced by lazy.nvim at startup regardless of this plugin's lazy
-- state, so filetype detection works before the rest of the plugin loads.
vim.filetype.add({ extension = { ptc = "lisptc" } })
-- No treesitter parser: the commonlisp one parses a whole .ptc buffer as code,
-- but here only the parenthesised forms are code and the prose around them is
-- ignored by the interpreter. syntax/lisptc.vim draws that distinction.
vim.api.nvim_create_autocmd("FileType", {
	pattern = "lisptc",
	callback = function()
		vim.bo.syntax = "lisptc"
	end,
})
