---
title: Markdown demo
tags: [viewer, smoke-test]
---

# Markdown demo

Exercises every construct the renderer supports. Open this file in the
viewer after an install to check it by eye; `markdown.test.ts` checks it by
assertion.

## Text

Plain text, **bold**, __also bold__, *italic*, _also italic_, ~~struck~~,
and `inline code`. A line that ends with two spaces  
breaks here.

## Lists

- tight item one
- tight item two
  - nested item

1. ordered one
2. ordered two

Loose list, with a blank line between items:

- first

- second

Task list:

- [ ] unchecked
- [x] checked

## Table

| Left | Center | Right |
| :-- | :-: | --: |
| a | b | c |
| left-aligned | centered | right-aligned |

## Code

```js
function add(a, b) {
  // sum two numbers
  return a + b;
}
```

```diff
- removed line
+ added line
  unchanged line
```

## Quote

> A blockquote.
>
> A second paragraph in the same quote.

## Details

<details>
<summary>Click to expand</summary>

Hidden content.

</details>

## Links and images

[a link](https://example.com/README.md "a title") and a bare
https://example.com/bare link.

![alt text](https://example.com/image.png)

## Unsupported by design

Footnotes are not supported: this is not a footnote reference[^1] and
renders as literal text.

[^1]: this definition also renders as literal text.

LaTeX is not supported: $E = mc^2$ and

$$
\int_0^1 x\,dx
$$

render as literal text, not equations.
