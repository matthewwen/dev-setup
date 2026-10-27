export const CHUNK = 256 * 1024;
export const TAIL_BYTES = 1024 * 1024;
export const MAX_LINES = 10000;

interface AnsiStyle {
  color?: string;
  backgroundColor?: string;
  fontWeight?: "bold";
}

export interface TextRun {
  text: string;
  style: AnsiStyle;
}

export interface LogLine {
  no: number | null;
  text: string;
  runs: TextRun[];
}

const COLORS = ["#555555", "#cc4444", "#4e9a46", "#b58900", "#528bce", "#aa55aa", "#299a9a", "#aaaaaa",
  "#888888", "#ff6666", "#77cc66", "#e5c84b", "#88b4ff", "#dd88dd", "#66cccc", "#eeeeee"];

function ansiColor(index: number): string {
  if (index < 16) {
    return COLORS[index];
  }
  if (index >= 232) {
    const gray = 8 + (index - 232) * 10;
    return `rgb(${gray}, ${gray}, ${gray})`;
  }
  const n = index - 16;
  const level = (v: number) => v === 0 ? 0 : 55 + v * 40;
  return `rgb(${level(Math.floor(n / 36))}, ${level(Math.floor(n / 6) % 6)}, ${level(n % 6)})`;
}

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const CSI = String.raw`(?:${ESC}\[|\x9b)([0-?]*)([ -/]*)([@-~])`;
const OSC = String.raw`(?:${ESC}\]|\x9d)[^${BEL}${ESC}]*(?:${BEL}|${ESC}\\)`;
const SINGLE_ESCAPE = String.raw`${ESC}[ -/]*[@-Z\\-_]`;
const INCOMPLETE_ESCAPE = String.raw`(?:${ESC}\[[^@-~]*|${ESC}\][^${BEL}]*|${ESC})$`;
const ANSI_ESCAPE = new RegExp([CSI, OSC, SINGLE_ESCAPE, INCOMPLETE_ESCAPE].join("|"), "g");
const CONTROLS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, "g");

export function formatAnsi(text: string, initial: AnsiStyle = {}): { runs: TextRun[]; style: AnsiStyle } {
  let style = { ...initial };
  const runs: TextRun[] = [];
  const plain = (value: string) => {
    const clean = value.replace(CONTROLS, "");
    if (clean) {
      runs.push({ text: clean, style: { ...style } });
    }
  };
  let at = 0;
  for (const match of text.matchAll(ANSI_ESCAPE)) {
    plain(text.slice(at, match.index));
    at = match.index! + match[0].length;
    if (match[3] !== "m") {
      continue;
    }
    const codes = match[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) {
        style = {};
      } else if (code === 1) {
        style.fontWeight = "bold";
      } else if (code === 22) {
        delete style.fontWeight;
      } else if (code === 39) {
        delete style.color;
      } else if (code === 49) {
        delete style.backgroundColor;
      } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
        style.color = COLORS[code >= 90 ? code - 90 + 8 : code - 30];
      } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
        style.backgroundColor = COLORS[code >= 100 ? code - 100 + 8 : code - 40];
      } else if (code === 38 || code === 48) {
        const key = code === 38 ? "color" : "backgroundColor";
        if (codes[i + 1] === 5 && codes[i + 2] >= 0 && codes[i + 2] <= 255) {
          style[key] = ansiColor(codes[i + 2]);
          i += 2;
        } else if (codes[i + 1] === 2 && codes.slice(i + 2, i + 5).length === 3 &&
          codes.slice(i + 2, i + 5).every(n => n >= 0 && n <= 255)) {
          style[key] = `rgb(${codes.slice(i + 2, i + 5).join(", ")})`;
          i += 4;
        }
      }
    }
  }
  plain(text.slice(at));
  return { runs, style };
}

export class TextBuffer {
  private decoder = new TextDecoder("utf-8");
  private partial = "";
  private style: AnsiStyle = {};
  private number = 1;
  private lines: LogLine[] = [];
  private skipFirst: boolean;
  private bounded = false;
  private numbered: boolean;

  constructor(numbered = true, skipFirst = false) {
    this.numbered = numbered;
    this.skipFirst = skipFirst;
  }

  append(bytes: ArrayBuffer, bounded = false) {
    this.bounded = bounded;
    const parts = (this.partial + this.decoder.decode(bytes, { stream: true })).split("\n");
    this.partial = parts.pop() ?? "";
    for (const part of parts) {
      const line = this.line(part.replace(/\r$/, ""));
      if (this.skipFirst) {
        this.skipFirst = false;
      } else {
        this.lines.push(line);
      }
    }
    if (bounded) {
      this.lines = this.lines.slice(-MAX_LINES);
      let remaining = TAIL_BYTES;
      this.partial = this.partial.slice(-remaining);
      remaining -= this.partial.length;
      let start = this.lines.length;
      while (start > 0 && remaining > 0) {
        remaining -= this.lines[--start].text.length + 1;
      }
      this.lines = this.lines.slice(remaining < 0 ? start + 1 : start);
    }
  }

  private line(raw: string): LogLine {
    let runs: TextRun[] = [];
    for (const part of raw.split("\r")) {
      const formatted = formatAnsi(part, this.style);
      this.style = formatted.style;
      runs = formatted.runs;
    }
    return { no: this.numbered ? this.number++ : null, text: runs.map(run => run.text).join(""), runs };
  }

  snapshot(): LogLine[] {
    if (!this.partial || this.skipFirst) {
      return [...this.lines];
    }
    const style = this.style;
    const number = this.number;
    const partial = this.line(this.partial.replace(/\r$/, ""));
    this.style = style;
    this.number = number;
    return [...(this.bounded ? this.lines.slice(-MAX_LINES + 1) : this.lines), partial];
  }
}

export async function readTextRange(src: string, from: number | null, to: number, signal: AbortSignal) {
  const response = await fetch(src, {
    headers: { Range: from === null ? `bytes=-${to}` : `bytes=${from}-${to}` },
    cache: "no-store",
    signal,
  });
  const range = response.headers.get("Content-Range");
  const total = range ? Number(range.split("/")[1]) : Number(response.headers.get("Content-Length") ?? NaN);
  if (response.status === 416 && Number.isFinite(total)) {
    return { bytes: new ArrayBuffer(0), start: total, total, ranged: true };
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  if (!range && ((from !== null && from > 0) || total > TAIL_BYTES)) {
    await response.body?.cancel();
    throw new Error("The server must support byte ranges to read this file.");
  }
  const bytes = await response.arrayBuffer();
  const start = range ? Number(range.match(/bytes (\d+)-/)?.[1] ?? 0) : 0;
  return { bytes, start, total: Number.isFinite(total) ? total : start + bytes.byteLength, ranged: Boolean(range) };
}

export function followReadMode(next: number, size: number, previousVersion: string | null, version: string | null) {
  if (size < next || (size === next && previousVersion !== null && version !== previousVersion) || size - next > TAIL_BYTES) {
    return "tail";
  }
  return size > next ? "live" : null;
}
