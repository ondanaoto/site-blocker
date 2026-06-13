// document_start で走る保険ブロッカ。dNR が prerender 等を取りこぼした場合の最終防衛線。
// lib/ を import できないので必要な純粋関数は inline する。
(async () => {
  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  function isRangeActive(range, nowMin) {
    if (!range || !range.start || !range.end) return false;
    const s = toMinutes(range.start);
    const e = toMinutes(range.end);
    if (s === e) return false;
    if (s < e) return nowMin >= s && nowMin < e;
    return nowMin >= s || nowMin < e;
  }

  function hostMatchesDomain(host, domain) {
    return host === domain || host.endsWith("." + domain);
  }

  let host;
  try {
    host = location.hostname.toLowerCase().replace(/^www\./, "");
  } catch (_e) {
    return;
  }
  if (!host) return;

  const { siteBlockerRules: rules = [] } =
    (await chrome.storage.local.get("siteBlockerRules")) || {};
  if (!Array.isArray(rules) || rules.length === 0) return;

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  for (const rule of rules) {
    if (!rule || !rule.enabled) continue;
    const domains = (rule.domains || [])
      .map((d) => (d || "").trim().toLowerCase())
      .filter(Boolean);
    if (!domains.some((d) => hostMatchesDomain(host, d))) continue;
    const ranges = Array.isArray(rule.ranges) ? rule.ranges : [];
    if (!ranges.some((r) => isRangeActive(r, nowMin))) continue;
    // マッチ → ブロックページへ即座に置換
    location.replace(
      chrome.runtime.getURL(
        `/blocked.html?domain=${encodeURIComponent(host)}`,
      ),
    );
    return;
  }
})();
