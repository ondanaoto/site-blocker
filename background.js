import {
  currentMinutes,
  nextBoundaryDeltaMinutes,
  currentlyActiveDomains,
} from "./lib/time.js";
import {
  isInEditWindow,
  minutesUntilEditWindowChange,
  DEFAULT_EDIT_WINDOW,
} from "./lib/policy.js";

const RULES_KEY = "siteBlockerRules";
const LEGACY_SITES_KEY = "siteBlockerSites";
const CONFIG_KEY = "siteBlockerConfig";
const ALARM_TICK = "siteBlockerTick";
const ALARM_EDITWIN = "siteBlockerEditWindowPromote";

let previousActiveDomains = new Set();

function newRuleId() {
  return "r_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// 旧 siteBlockerSites を siteBlockerRules に移行する。
async function migrateIfNeeded() {
  const r = await chrome.storage.local.get([RULES_KEY, LEGACY_SITES_KEY]);
  if (r[RULES_KEY]) return r[RULES_KEY];
  if (Array.isArray(r[LEGACY_SITES_KEY])) {
    const rules = r[LEGACY_SITES_KEY].map((s) => ({
      id: newRuleId(),
      name: "",
      enabled: s.enabled !== false,
      domains: s.domain ? [s.domain] : [],
      ranges: Array.isArray(s.ranges) ? s.ranges : [],
    }));
    await chrome.storage.local.set({ [RULES_KEY]: rules });
    await chrome.storage.local.remove(LEGACY_SITES_KEY);
    return rules;
  }
  return [];
}

async function loadAll() {
  const rules = await migrateIfNeeded();
  const r = await chrome.storage.local.get(CONFIG_KEY);
  const stored = r[CONFIG_KEY] || {};
  const config = {
    editWindow: stored.editWindow || { ...DEFAULT_EDIT_WINDOW },
    editWindowEverChanged: !!stored.editWindowEverChanged,
    pendingEditWindow: stored.pendingEditWindow || null,
  };
  return { rules, config };
}

async function saveConfig(config) {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

async function promotePendingEditWindowIfDue(config) {
  const p = config.pendingEditWindow;
  if (!p) return config;
  if (Date.now() >= p.effectiveAt) {
    const next = {
      ...config,
      editWindow: { ...p.value },
      pendingEditWindow: null,
      editWindowEverChanged: true,
    };
    await saveConfig(next);
    return next;
  }
  return config;
}

async function applyRules() {
  let { rules, config } = await loadAll();
  config = await promotePendingEditWindowIfDue(config);

  const nowMin = currentMinutes();
  const activeDomains = currentlyActiveDomains(rules, nowMin);

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);

  // ドメインごとに 1 ルール (blocked.html?domain=... を渡したいので)
  const addRules = activeDomains.map((domain, idx) => ({
    id: idx + 1,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        extensionPath: `/blocked.html?domain=${encodeURIComponent(domain)}`,
      },
    },
    condition: {
      requestDomains: [domain],
      resourceTypes: ["main_frame"],
    },
  }));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });

  console.log(
    `[site-blocker] applyRules @${String(Math.floor(nowMin / 60)).padStart(2, "0")}:${String(nowMin % 60).padStart(2, "0")} — rules=${rules.length}, activeDomains=${activeDomains.length}`,
    activeDomains,
  );

  const newlyActive = activeDomains.filter((d) => !previousActiveDomains.has(d));
  previousActiveDomains = new Set(activeDomains);
  if (newlyActive.length > 0) {
    await reloadTabsForDomains(newlyActive);
  }

  await scheduleNextTick(rules, nowMin);
  await scheduleEditWindowPromote(config);
}

async function reloadTabsForDomains(domains) {
  for (const domain of domains) {
    let tabs;
    try {
      tabs = await chrome.tabs.query({
        url: [`*://${domain}/*`, `*://*.${domain}/*`],
      });
    } catch (e) {
      console.warn(`[site-blocker] tabs.query failed for ${domain}`, e);
      continue;
    }
    for (const tab of tabs) {
      try {
        await chrome.tabs.reload(tab.id);
      } catch (e) {
        console.warn(`[site-blocker] tabs.reload failed for ${tab.id}`, e);
      }
    }
  }
}

async function scheduleNextTick(rules, nowMin) {
  await chrome.alarms.clear(ALARM_TICK);
  const delta = nextBoundaryDeltaMinutes(rules, nowMin);
  if (delta == null) return;
  chrome.alarms.create(ALARM_TICK, { delayInMinutes: Math.max(delta + 0.05, 0.1) });
}

async function scheduleEditWindowPromote(config) {
  await chrome.alarms.clear(ALARM_EDITWIN);
  if (!config.pendingEditWindow) return;
  const delta = Math.max(config.pendingEditWindow.effectiveAt - Date.now(), 1000);
  chrome.alarms.create(ALARM_EDITWIN, { when: Date.now() + delta });
}

chrome.runtime.onInstalled.addListener((details) => {
  applyRules();
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(() => applyRules());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_TICK || alarm.name === ALARM_EDITWIN) applyRules();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[RULES_KEY] || changes[CONFIG_KEY]) applyRules();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === "getStatus") {
    (async () => {
      const { rules, config } = await loadAll();
      const nowMin = currentMinutes();
      const active = currentlyActiveDomains(rules, nowMin);
      const inWindow = isInEditWindow(config.editWindow, nowMin);
      const minutesUntilChange = minutesUntilEditWindowChange(config.editWindow, nowMin);
      sendResponse({
        active,
        totalRules: rules.length,
        editWindow: config.editWindow,
        inWindow,
        minutesUntilChange,
        pendingEditWindow: config.pendingEditWindow,
      });
    })();
    return true;
  }
});
