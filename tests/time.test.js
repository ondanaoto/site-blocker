import test from "node:test";
import assert from "node:assert/strict";
import {
  toMinutes,
  fromMinutes,
  isRangeActive,
  isRuleActiveNow,
  currentlyActiveDomains,
  nextBoundaryDeltaMinutes,
} from "../lib/time.js";

test("toMinutes / fromMinutes", () => {
  assert.equal(toMinutes("09:30"), 570);
  assert.equal(toMinutes("00:00"), 0);
  assert.equal(toMinutes("23:59"), 1439);
  assert.equal(fromMinutes(570), "09:30");
  assert.equal(fromMinutes(0), "00:00");
});

test("isRangeActive: 通常範囲", () => {
  const r = { start: "09:00", end: "18:00" };
  assert.equal(isRangeActive(r, 540), true);
  assert.equal(isRangeActive(r, 1079), true);
  assert.equal(isRangeActive(r, 1080), false);
  assert.equal(isRangeActive(r, 480), false);
});

test("isRangeActive: 日をまたぐ範囲", () => {
  const r = { start: "22:00", end: "02:00" };
  assert.equal(isRangeActive(r, 1320), true);
  assert.equal(isRangeActive(r, 60), true);
  assert.equal(isRangeActive(r, 120), false);
  assert.equal(isRangeActive(r, 720), false);
});

test("isRuleActiveNow: enabled=false なら常に false", () => {
  const rule = {
    enabled: false,
    domains: ["a.com"],
    ranges: [{ start: "00:00", end: "23:59" }],
  };
  assert.equal(isRuleActiveNow(rule, 600), false);
});

test("isRuleActiveNow: 複数レンジのいずれかが active なら true", () => {
  const rule = {
    enabled: true,
    domains: ["a.com"],
    ranges: [
      { start: "09:00", end: "12:00" },
      { start: "14:00", end: "18:00" },
    ],
  };
  assert.equal(isRuleActiveNow(rule, 600), true);
  assert.equal(isRuleActiveNow(rule, 780), false);
  assert.equal(isRuleActiveNow(rule, 900), true);
});

test("currentlyActiveDomains: ルールに含まれる全ドメインを返す", () => {
  const rules = [
    {
      enabled: true,
      domains: ["twitter.com", "facebook.com"],
      ranges: [{ start: "09:00", end: "12:00" }],
    },
    {
      enabled: true,
      domains: ["youtube.com"],
      ranges: [{ start: "20:00", end: "23:00" }],
    },
  ];
  const a = currentlyActiveDomains(rules, 600);
  assert.deepEqual(a.sort(), ["facebook.com", "twitter.com"]);
  const b = currentlyActiveDomains(rules, 1260); // 21:00
  assert.deepEqual(b, ["youtube.com"]);
  const c = currentlyActiveDomains(rules, 800); // 13:20 どこにも該当しない
  assert.deepEqual(c, []);
});

test("currentlyActiveDomains: 重複は除去される", () => {
  const rules = [
    { enabled: true, domains: ["a.com"], ranges: [{ start: "09:00", end: "18:00" }] },
    { enabled: true, domains: ["a.com"], ranges: [{ start: "10:00", end: "19:00" }] },
  ];
  const a = currentlyActiveDomains(rules, 660);
  assert.deepEqual(a, ["a.com"]);
});

test("nextBoundaryDeltaMinutes: 全ルールの境界を考慮", () => {
  const rules = [
    {
      enabled: true,
      domains: ["a.com"],
      ranges: [{ start: "09:00", end: "12:00" }],
    },
    {
      enabled: true,
      domains: ["b.com"],
      ranges: [{ start: "14:00", end: "18:00" }],
    },
  ];
  assert.equal(nextBoundaryDeltaMinutes(rules, 600), 120); // 10:00 → 12:00
  assert.equal(nextBoundaryDeltaMinutes(rules, 780), 60); // 13:00 → 14:00
});

test("nextBoundaryDeltaMinutes: ルールなし or 全 disabled は null", () => {
  assert.equal(nextBoundaryDeltaMinutes([], 600), null);
  assert.equal(
    nextBoundaryDeltaMinutes(
      [{ enabled: false, domains: ["a.com"], ranges: [{ start: "09:00", end: "18:00" }] }],
      600,
    ),
    null,
  );
});
