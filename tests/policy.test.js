import test from "node:test";
import assert from "node:assert/strict";
import {
  isInEditWindow,
  minutesUntilEditWindowChange,
  expandRulesToDomainBitmaps,
  classifyDiff,
  classifyEditWindowChange,
} from "../lib/policy.js";

test("isInEditWindow", () => {
  const ew = { start: "03:00", end: "04:00" };
  assert.equal(isInEditWindow(ew, 180), true);
  assert.equal(isInEditWindow(ew, 240), false);
  assert.equal(isInEditWindow(ew, 600), false);
});

test("minutesUntilEditWindowChange", () => {
  const ew = { start: "03:00", end: "04:00" };
  assert.equal(minutesUntilEditWindowChange(ew, 180), 60);
  assert.equal(minutesUntilEditWindowChange(ew, 210), 30);
  assert.equal(minutesUntilEditWindowChange(ew, 240), 23 * 60);
  assert.equal(minutesUntilEditWindowChange(ew, 120), 60);
});

test("expandRulesToDomainBitmaps: 単一ドメイン", () => {
  const m = expandRulesToDomainBitmaps([
    {
      enabled: true,
      domains: ["a.com"],
      ranges: [{ start: "09:00", end: "12:00" }],
    },
  ]);
  const bits = m.get("a.com");
  assert.equal(bits[540], true);
  assert.equal(bits[720], false);
});

test("expandRulesToDomainBitmaps: 同じドメインが複数ルールにある場合は union", () => {
  const m = expandRulesToDomainBitmaps([
    { enabled: true, domains: ["a.com"], ranges: [{ start: "09:00", end: "12:00" }] },
    { enabled: true, domains: ["a.com"], ranges: [{ start: "14:00", end: "18:00" }] },
  ]);
  const bits = m.get("a.com");
  assert.equal(bits.filter(Boolean).length, 3 * 60 + 4 * 60);
});

test("expandRulesToDomainBitmaps: ドメインは小文字 + trim", () => {
  const m = expandRulesToDomainBitmaps([
    {
      enabled: true,
      domains: [" Twitter.com ", "FACEBOOK.com"],
      ranges: [{ start: "09:00", end: "12:00" }],
    },
  ]);
  assert.equal(m.has("twitter.com"), true);
  assert.equal(m.has("facebook.com"), true);
});

test("expandRulesToDomainBitmaps: enabled=false は無視", () => {
  const m = expandRulesToDomainBitmaps([
    { enabled: false, domains: ["a.com"], ranges: [{ start: "09:00", end: "12:00" }] },
  ]);
  assert.equal(m.size, 0);
});

test("classifyDiff: 変化なし", () => {
  const rules = [
    { enabled: true, domains: ["a.com"], ranges: [{ start: "09:00", end: "12:00" }] },
  ];
  const r = classifyDiff(rules, rules);
  assert.equal(r.kind, "none");
});

test("classifyDiff: ルール内ドメイン追加は strict", () => {
  const saved = [
    { enabled: true, domains: ["a.com"], ranges: [{ start: "09:00", end: "12:00" }] },
  ];
  const draft = [
    {
      enabled: true,
      domains: ["a.com", "b.com"],
      ranges: [{ start: "09:00", end: "12:00" }],
    },
  ];
  const r = classifyDiff(saved, draft);
  assert.equal(r.kind, "strict");
  assert.deepEqual(r.strictDomains, ["b.com"]);
  assert.equal(r.perDomain.get("a.com"), "none");
});

test("classifyDiff: ルール内ドメイン削除は lax", () => {
  const saved = [
    {
      enabled: true,
      domains: ["a.com", "b.com"],
      ranges: [{ start: "09:00", end: "12:00" }],
    },
  ];
  const draft = [
    { enabled: true, domains: ["a.com"], ranges: [{ start: "09:00", end: "12:00" }] },
  ];
  const r = classifyDiff(saved, draft);
  assert.equal(r.kind, "lax");
  assert.deepEqual(r.laxDomains, ["b.com"]);
});

test("classifyDiff: ルール全体削除は全ドメインが lax", () => {
  const saved = [
    {
      enabled: true,
      domains: ["a.com", "b.com"],
      ranges: [{ start: "09:00", end: "12:00" }],
    },
  ];
  const r = classifyDiff(saved, []);
  assert.equal(r.kind, "lax");
  assert.deepEqual(r.laxDomains.sort(), ["a.com", "b.com"]);
});

test("classifyDiff: レンジ短縮は lax", () => {
  const saved = [
    { enabled: true, domains: ["a.com"], ranges: [{ start: "09:00", end: "12:00" }] },
  ];
  const draft = [
    { enabled: true, domains: ["a.com"], ranges: [{ start: "10:00", end: "12:00" }] },
  ];
  const r = classifyDiff(saved, draft);
  assert.equal(r.kind, "lax");
  assert.equal(r.perDomain.get("a.com"), "lax");
});

test("classifyDiff: レンジ拡張は strict", () => {
  const saved = [
    { enabled: true, domains: ["a.com"], ranges: [{ start: "09:00", end: "12:00" }] },
  ];
  const draft = [
    { enabled: true, domains: ["a.com"], ranges: [{ start: "09:00", end: "13:00" }] },
  ];
  const r = classifyDiff(saved, draft);
  assert.equal(r.kind, "strict");
});

test("classifyDiff: あるドメインが2ルールに登場し片方を消しても、もう一方でカバーされてれば none", () => {
  const saved = [
    { enabled: true, domains: ["a.com"], ranges: [{ start: "09:00", end: "18:00" }] },
    { enabled: true, domains: ["a.com"], ranges: [{ start: "10:00", end: "12:00" }] },
  ];
  const draft = [
    { enabled: true, domains: ["a.com"], ranges: [{ start: "09:00", end: "18:00" }] },
  ];
  const r = classifyDiff(saved, draft);
  assert.equal(r.kind, "none");
});

test("classifyEditWindowChange", () => {
  const saved = {
    editWindow: { start: "00:00", end: "23:59" },
    editWindowEverChanged: false,
  };
  assert.equal(
    classifyEditWindowChange(saved, { editWindow: { start: "00:00", end: "23:59" } }),
    "none",
  );
  // 初回 (everChanged=false) → first
  assert.equal(
    classifyEditWindowChange(saved, { editWindow: { start: "03:00", end: "04:00" } }),
    "first",
  );
  // 2回目以降 → delayed
  const saved2 = {
    editWindow: { start: "03:00", end: "04:00" },
    editWindowEverChanged: true,
  };
  assert.equal(
    classifyEditWindowChange(saved2, { editWindow: { start: "05:00", end: "06:00" } }),
    "delayed",
  );
});
