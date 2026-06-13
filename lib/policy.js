// 編集窓・厳格/緩和の判定ロジック。chrome.* に依存しない。

import { toMinutes, isRangeActive } from "./time.js";

export const DEFAULT_EDIT_WINDOW = { start: "00:00", end: "23:59" }; // 初回は全日オープン
export const EDIT_WINDOW_DELAY_MS = 24 * 60 * 60 * 1000;
export const LAX_APPLY_DELAY_MS = 60 * 1000;

export function isInEditWindow(editWindow, nowMin) {
  return isRangeActive(editWindow, nowMin);
}

export function minutesUntilEditWindowChange(editWindow, nowMin) {
  const inWindow = isInEditWindow(editWindow, nowMin);
  const target = inWindow ? toMinutes(editWindow.end) : toMinutes(editWindow.start);
  let delta = target - nowMin;
  if (delta <= 0) delta += 1440;
  return delta;
}

function rangesToBitmap(ranges) {
  const bits = new Array(1440).fill(false);
  if (!Array.isArray(ranges)) return bits;
  for (const r of ranges) {
    if (!r || !r.start || !r.end) continue;
    const s = toMinutes(r.start);
    const e = toMinutes(r.end);
    if (s === e) continue;
    if (s < e) {
      for (let i = s; i < e; i++) bits[i] = true;
    } else {
      for (let i = s; i < 1440; i++) bits[i] = true;
      for (let i = 0; i < e; i++) bits[i] = true;
    }
  }
  return bits;
}

// 全ルールを (domain -> 分ビットマップ) に展開。
// 同じドメインが複数ルールに登場する場合は union を取る。
export function expandRulesToDomainBitmaps(rules) {
  const map = new Map();
  if (!Array.isArray(rules)) return map;
  for (const rule of rules) {
    if (!rule || !rule.enabled) continue;
    const ruleBits = rangesToBitmap(rule.ranges);
    for (const raw of rule.domains || []) {
      const d = (raw || "").trim().toLowerCase();
      if (!d) continue;
      let bits = map.get(d);
      if (!bits) {
        bits = new Array(1440).fill(false);
        map.set(d, bits);
      }
      for (let i = 0; i < 1440; i++) if (ruleBits[i]) bits[i] = true;
    }
  }
  return map;
}

function bitsCount(bits) {
  let n = 0;
  for (let i = 0; i < 1440; i++) if (bits[i]) n++;
  return n;
}

function bitsDiff(a, b) {
  let added = 0,
    removed = 0;
  for (let i = 0; i < 1440; i++) {
    if (!a[i] && b[i]) added++;
    if (a[i] && !b[i]) removed++;
  }
  return { added, removed };
}

// ドメイン単位の変化分類。"none" | "added" | "removed" | "strict" | "lax"
function classifyDomain(beforeBits, afterBits) {
  const beforeOn = bitsCount(beforeBits);
  const afterOn = bitsCount(afterBits);
  if (beforeOn === 0 && afterOn === 0) return "none";
  if (beforeOn === 0 && afterOn > 0) return "added";
  if (beforeOn > 0 && afterOn === 0) return "removed";
  const { added, removed } = bitsDiff(beforeBits, afterBits);
  if (added === 0 && removed === 0) return "none";
  if (removed === 0) return "strict";
  return "lax";
}

// ルール変更全体の分類。
//   kind: "none" | "strict" | "lax"
//   perDomain: Map<domain, kind>
//   laxDomains/strictDomains: ドメイン名配列
export function classifyDiff(savedRules, draftRules) {
  const before = expandRulesToDomainBitmaps(savedRules);
  const after = expandRulesToDomainBitmaps(draftRules);
  const allDomains = new Set([...before.keys(), ...after.keys()]);
  const perDomain = new Map();
  const laxDomains = [];
  const strictDomains = [];
  const zero = new Array(1440).fill(false);
  for (const d of allDomains) {
    const kind = classifyDomain(before.get(d) || zero, after.get(d) || zero);
    perDomain.set(d, kind);
    if (kind === "lax" || kind === "removed") laxDomains.push(d);
    else if (kind === "strict" || kind === "added") strictDomains.push(d);
  }
  let kind = "none";
  if (laxDomains.length > 0) kind = "lax";
  else if (strictDomains.length > 0) kind = "strict";
  return { kind, perDomain, laxDomains, strictDomains };
}

export function classifyEditWindowChange(savedConfig, draftConfig) {
  const sw = savedConfig?.editWindow;
  const dw = draftConfig?.editWindow;
  if (!dw) return "none";
  if (sw && sw.start === dw.start && sw.end === dw.end) return "none";
  if (!sw || !savedConfig?.editWindowEverChanged) return "first";
  return "delayed";
}
