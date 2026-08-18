-- Runtimepath for headless test runs: plenary (vendored by run.sh) plus this
-- plugin's own lua/ dir, so `require("lisptc.*")` resolves.
local tests_dir = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":p:h")
local plugin_dir = vim.fn.fnamemodify(tests_dir, ":h")

vim.opt.runtimepath:append(tests_dir .. "/../.vendor/plenary.nvim")
vim.opt.runtimepath:append(plugin_dir)

vim.cmd("runtime! plugin/plenary.vim")
