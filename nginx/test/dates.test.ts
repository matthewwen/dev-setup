import { test } from "node:test";
import assert from "node:assert/strict";
import { dateGroup, groupByDate } from "../src/prompts/dates.ts";

const now = new Date(2026, 9, 13, 15, 0, 0);
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime() / 1000;

test("dateGroup buckets by local calendar day", () => {
  assert.equal(dateGroup(at(2026, 9, 13, 0), now), "Today");
  assert.equal(dateGroup(at(2026, 9, 12, 23), now), "Yesterday");
  assert.equal(dateGroup(at(2026, 9, 7), now), "Previous 7 days");
  assert.equal(dateGroup(at(2026, 8, 20), now), "Previous 30 days");
  assert.equal(dateGroup(at(2026, 7, 1), now), "August 2026");
});

test("groupByDate keeps row order and merges consecutive labels", () => {
  const rows = [at(2026, 9, 13), at(2026, 9, 13, 9), at(2026, 9, 12), at(2026, 7, 1)];
  const groups = groupByDate(rows, r => r, now);
  assert.deepEqual(groups.map(([label, g]) => [label, g.length]), [
    ["Today", 2],
    ["Yesterday", 1],
    ["August 2026", 1],
  ]);
});

test("groupByDate gives each label one group when rows arrive out of order", () => {
  const rows = [at(2026, 9, 13), at(2026, 8, 20), at(2026, 9, 12), at(2026, 8, 25)];
  const groups = groupByDate(rows, r => r, now);
  assert.deepEqual(groups.map(([label, g]) => [label, g]), [
    ["Today", [at(2026, 9, 13)]],
    ["Yesterday", [at(2026, 9, 12)]],
    ["Previous 30 days", [at(2026, 8, 25), at(2026, 8, 20)]],
  ]);
});
