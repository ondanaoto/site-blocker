// 時刻まわりの純粋関数。chrome.* に依存しないので Node から直接テストできる。

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function isRangeActive(range, nowMin) {
  const start = toMinutes(range.start);
  const end = toMinutes(range.end);
  if (start === end) return false;
  if (start < end) return nowMin >= start && nowMin < end;
  return nowMin >= start || nowMin < end; // 日をまたぐ
}

export function isRuleActiveNow(rule, nowMin) {
  if (!rule || !rule.enabled || !Array.isArray(rule.ranges)) return false;
  return rule.ranges.some((r) => isRangeActive(r, nowMin));
}

export function currentlyActiveDomains(rules, nowMin) {
  const domains = new Set();
  for (const rule of rules) {
    if (!isRuleActiveNow(rule, nowMin)) continue;
    for (const d of rule.domains || []) {
      const norm = d.trim().toLowerCase();
      if (norm) domains.add(norm);
    }
  }
  return [...domains];
}

export function currentMinutes(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

export function nextBoundaryDeltaMinutes(rules, nowMin) {
  const boundaries = new Set();
  for (const rule of rules) {
    if (!rule.enabled || !Array.isArray(rule.ranges)) continue;
    for (const r of rule.ranges) {
      if (!r.start || !r.end) continue;
      boundaries.add(toMinutes(r.start));
      boundaries.add(toMinutes(r.end));
    }
  }
  if (boundaries.size === 0) return null;
  const sorted = [...boundaries].sort((a, b) => a - b);
  const next = sorted.find((b) => b > nowMin);
  if (next !== undefined) return next - nowMin;
  return 1440 - nowMin + sorted[0];
}
