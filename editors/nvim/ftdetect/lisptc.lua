-- Always sourced by lazy.nvim at startup regardless of this plugin's lazy
-- state, so filetype detection works before the rest of the plugin loads.
vim.filetype.add({ extension = { ptc = "lisptc" } })
vim.treesitter.language.register("commonlisp", "lisptc")
vim.api.nvim_create_autocmd("FileType", {
	pattern = "lisptc",
	callback = function()
		vim.bo.syntax = "lisp"
	end,
})
