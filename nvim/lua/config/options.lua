-- Inherit full PATH from login shell (picks up mise, homebrew, etc.)
local shell_path = vim.fn.system("zsh -lc 'echo $PATH'"):gsub("\n", "")
if shell_path ~= "" then
  vim.env.PATH = shell_path
end

local opt = vim.opt

opt.number = true
opt.relativenumber = false
opt.mouse = "a"
opt.wrap = false

opt.tabstop = 4
opt.shiftwidth = 4
opt.softtabstop = 4
opt.expandtab = true
opt.smartindent = true

opt.termguicolors = true
opt.signcolumn = "yes"
opt.cursorline = true
opt.scrolloff = 8
opt.laststatus = 0
opt.cmdheight = 0
opt.showtabline = 2
opt.tabline = "%!v:lua.Tabline()"

function Tabline()
  local tabs = {}
  for i = 1, vim.fn.tabpagenr("$") do
    local winnr = vim.fn.tabpagewinnr(i)
    local bufnr = vim.fn.tabpagebuflist(i)[winnr]
    local name = vim.fn.fnamemodify(vim.fn.bufname(bufnr), ":t")
    if name == "" then name = "[No Name]" end
    local hl = (i == vim.fn.tabpagenr()) and "%#TabLineSel#" or "%#TabLine#"
    table.insert(tabs, "%" .. i .. "T" .. hl .. " " .. i .. " " .. name .. " ")
  end
  return table.concat(tabs) .. "%T%#TabLineFill#"
end

-- Force absolute line numbers after LazyVim loads
vim.api.nvim_create_autocmd("User", {
  pattern = "VeryLazy",
  callback = function()
    vim.opt.relativenumber = false
  end,
})

-- Clipboard: copy yanked text to system clipboard via OSC52
vim.api.nvim_create_autocmd("TextYankPost", {
  callback = function()
    if vim.v.event.operator == "y" then
      local text = table.concat(vim.v.event.regcontents, "\n")
      if vim.v.event.regtype == "V" then
        text = text .. "\n"
      end
      require("vim.ui.clipboard.osc52").copy("+")(vim.split(text, "\n", { plain = true }))
    end
  end,
})

vim.g.mapleader = " "
vim.g.maplocalleader = "\\"
