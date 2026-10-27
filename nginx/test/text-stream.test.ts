import { test } from "node:test";
import assert from "node:assert/strict";
import { TextBuffer, MAX_LINES, TAIL_BYTES, formatAnsi, readTextRange, followReadMode } from "../src/viewers/text-stream.ts";

const bytes = (text: string) => new TextEncoder().encode(text).buffer;

test("an unterminated last line is updated instead of duplicated when the log grows", () => {
  const buffer = new TextBuffer();
  buffer.append(bytes("first\npar"));
  assert.deepEqual(buffer.snapshot().map(line => line.text), ["first", "par"]);
  buffer.append(bytes("tial\nnext"));
  assert.deepEqual(buffer.snapshot().map(line => [line.no, line.text]), [[1, "first"], [2, "partial"], [3, "next"]]);
});

test("UTF-8 characters survive a range boundary inside a multibyte character", () => {
  const buffer = new TextBuffer();
  const encoded = new TextEncoder().encode("你好\n");
  buffer.append(encoded.slice(0, 2).buffer);
  assert.deepEqual(buffer.snapshot(), []);
  buffer.append(encoded.slice(2).buffer);
  assert.equal(buffer.snapshot()[0].text, "你好");
});

test("an ANSI sequence split across reads stays hidden and retains color across lines", () => {
  const buffer = new TextBuffer();
  buffer.append(bytes("\x1b[3"));
  assert.equal(buffer.snapshot()[0].text, "");
  buffer.append(bytes("1mred\ncontinued\x1b[0m plain"));
  const [first, second] = buffer.snapshot();
  assert.equal(first.text, "red");
  assert.equal(second.text, "continued plain");
  assert.equal(first.runs[0].style.color, second.runs[0].style.color);
  assert.deepEqual(second.runs[1].style, {});
});

test("OSC hyperlinks and cursor controls cannot leak into the visible log", () => {
  const { runs } = formatAnsi("\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\\x1b[2K text");
  assert.equal(runs.map(run => run.text).join(""), "link text");
});

test("extended ANSI colors reset without styling the following text", () => {
  const { runs } = formatAnsi("\x1b[38;5;196mred\x1b[48;2;1;2;3mbackground\x1b[0mplain");
  assert.equal(runs[0].style.color, "rgb(255, 0, 0)");
  assert.equal(runs[1].style.backgroundColor, "rgb(1, 2, 3)");
  assert.deepEqual(runs[2].style, {});
});

test("carriage return progress replaces the previous value across reads", () => {
  const buffer = new TextBuffer();
  buffer.append(bytes("10%\r"));
  assert.equal(buffer.snapshot()[0].text, "10%");
  buffer.append(bytes("20%\r\n"));
  assert.equal(buffer.snapshot()[0].text, "20%");
});

test("a suffix range discards its first incomplete line", () => {
  const buffer = new TextBuffer(false, true);
  buffer.append(bytes("broken\nwhole\n"));
  assert.deepEqual(buffer.snapshot().map(line => [line.no, line.text]), [[null, "whole"]]);
});

test("follow mode bounds retained lines including a partial last line", () => {
  const buffer = new TextBuffer(false);
  buffer.append(bytes("line\n".repeat(MAX_LINES + 100) + "partial"), true);
  assert.equal(buffer.snapshot().length, MAX_LINES);
});

test("follow mode bounds a single line that grows without newlines", () => {
  const buffer = new TextBuffer(false);
  buffer.append(bytes("x".repeat(TAIL_BYTES + 50)), true);
  buffer.append(bytes("more"), true);
  assert.equal(buffer.snapshot()[0].text.length, TAIL_BYTES);
});

test("reading from the start retains chunks beyond the live history limit", () => {
  const buffer = new TextBuffer();
  buffer.append(bytes("line\n".repeat(MAX_LINES + 2) + "partial"));
  assert.equal(buffer.snapshot().length, MAX_LINES + 3);
});

test("an empty file's unsatisfied range is a valid empty read", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 416, headers: { "Content-Range": "bytes */0" } }));
  const result = await readTextRange("/empty", 0, 100, new AbortController().signal);
  assert.equal(result.total, 0);
  assert.equal(result.bytes.byteLength, 0);
});

test("a server ignoring an append range cannot duplicate the whole log", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("whole file"));
  await assert.rejects(readTextRange("/log", 10, 100, new AbortController().signal), /support byte ranges/);
});

test("a suffix read records the actual byte offset returned by the server", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("tail", {
    status: 206, headers: { "Content-Range": "bytes 100-103/104" },
  }));
  const result = await readTextRange("/log", null, 4, new AbortController().signal);
  assert.equal(result.start, 100);
  assert.equal(result.total, 104);
});

test("truncation restarts from the tail instead of waiting for the old size", () => {
  assert.equal(followReadMode(100, 20, "old", "new"), "tail");
});

test("a changed same-size file is reloaded", () => {
  assert.equal(followReadMode(100, 100, "old", "new"), "tail");
});

test("a growth burst larger than the live window skips to recent output", () => {
  assert.equal(followReadMode(100, 100 + TAIL_BYTES + 1, "old", "new"), "tail");
});

test("an unchanged file does not request another range", () => {
  assert.equal(followReadMode(100, 100, "same", "same"), null);
});
