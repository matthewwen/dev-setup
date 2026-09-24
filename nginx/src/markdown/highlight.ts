import { esc } from "../shared/format.ts";

// A short keyword list across the languages that show up in this repo's
// notes and code blocks, not a real tokenizer for any one of them.
const KEYWORDS = new RegExp(
  "\\b(?:" +
    [
      "const", "let", "var", "function", "return", "class", "extends", "new", "this", "typeof", "instanceof",
      "import", "from", "export", "default", "async", "await", "yield", "throw",
      "if", "else", "elif", "for", "while", "do", "switch", "case", "break", "continue", "try", "except",
      "catch", "finally", "with", "as", "in", "is", "not", "and", "or", "def", "lambda", "pass", "raise",
      "self", "None", "True", "False", "null", "nil", "true", "false", "void", "public", "private", "static",
      "struct", "enum", "interface", "type", "impl", "fn", "pub", "mut", "match", "use", "package", "func",
      "then", "fi", "esac", "done", "local", "echo", "set", "unset", "sudo", "cd", "kubectl", "helm", "git",
    ].join("|") +
    ")\\b",
);

const NO_HASH_COMMENT = new Set(["css", "scss", "less", "json", "json5", "html", "xml", "c", "cpp", "h"]);

export function highlight(code: string, lang: string | undefined): string {
  const l = (lang || "").toLowerCase();
  if (l === "diff" || l === "patch") {
    return code
      .split("\n")
      .map(line => {
        const cls = /^\+/.test(line) ? "diff-a" : /^-/.test(line) ? "diff-d" : /^@@/.test(line) ? "tok-com" : "";
        return cls ? `<span class="${cls}">${esc(line)}</span>` : esc(line);
      })
      .join("\n");
  }
  const parts = ['("(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`)'];
  parts.push(NO_HASH_COMMENT.has(l) ? "(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)" : "(#[^\\n]*|\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)");
  parts.push("(\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[-+]?\\d+)?\\b|\\b0x[0-9a-f]+\\b)");
  parts.push(`(${KEYWORDS.source})`);
  const re = new RegExp(parts.join("|"), "gi");
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    out += esc(code.slice(last, m.index));
    const cls = m[1] ? "tok-str" : m[2] ? "tok-com" : m[3] ? "tok-num" : "tok-kw";
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(code.slice(last));
}
