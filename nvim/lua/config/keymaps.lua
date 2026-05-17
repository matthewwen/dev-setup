local map = vim.keymap.set

-- Telescope (matching your fzf muscle memory)
map("n", "<C-p>", function() require("telescope.builtin").find_files() end)
map("n", "<leader>f", function() require("telescope.builtin").live_grep() end)
map("n", "<leader>b", function() require("telescope.builtin").buffers() end)

-- Parity: old vim \-leader bindings
map("n", "\\f", function() require("telescope.builtin").live_grep() end)
map("n", "\\b", function() require("telescope.builtin").buffers() end)

vim.api.nvim_create_autocmd("User", {
  pattern = "VeryLazy",
  callback = function()
    vim.keymap.set("n", "<C-f>", function()
      require("telescope.builtin").current_buffer_fuzzy_find()
    end)
  end,
})

-- Tabs
map("n", "<C-t>", "<cmd>tabnew<cr>")

-- Splits
map("n", "|", "<cmd>vsplit<cr>")
map("n", "_", "<cmd>split<cr>")

-- Move between windows
map("n", "<C-h>", "<C-w>h")
map("n", "<C-j>", "<C-w>j")
map("n", "<C-k>", "<C-w>k")
map("n", "<C-l>", "<C-w>l")

-- Resize
map("n", "<C-Up>", "<cmd>resize +2<cr>")
map("n", "<C-Down>", "<cmd>resize -2<cr>")
map("n", "<C-Left>", "<cmd>vertical resize -2<cr>")
map("n", "<C-Right>", "<cmd>vertical resize +2<cr>")

-- Move lines
map("v", "J", ":m '>+1<cr>gv=gv")
map("v", "K", ":m '<-2<cr>gv=gv")

-- Keep cursor centered
map("n", "<C-d>", "<C-d>zz")
map("n", "<C-u>", "<C-u>zz")
map("n", "n", "nzzzv")
map("n", "N", "Nzzzv")
