import { currentMinutes } from "./lib/time.js";
import {
  classifyDiff,
  classifyEditWindowChange,
  isInEditWindow,
  minutesUntilEditWindowChange,
  DEFAULT_EDIT_WINDOW,
  EDIT_WINDOW_DELAY_MS,
  LAX_APPLY_DELAY_MS,
} from "./lib/policy.js";

const RULES_KEY = "siteBlockerRules";
const LEGACY_SITES_KEY = "siteBlockerSites";
const CONFIG_KEY = "siteBlockerConfig";

const rulesEl = document.getElementById("rules");
const ruleTpl = document.getElementById("ruleTemplate");
const rangeTpl = document.getElementById("rangeTemplate");
const addRuleBtn = document.getElementById("addRule");
const statusEl = document.getElementById("status");

const editWinStart = document.getElementById("editWindowStart");
const editWinEnd = document.getElementById("editWindowEnd");
const editWinHint = document.getElementById("editWindowHint");
const pendingBanner = document.getElementById("pendingBanner");

const saveBar = document.getElementById("saveBar");
const saveBarSummary = document.getElementById("saveBarSummary");
const saveBtn = document.getElementById("saveBtn");
const discardBtn = document.getElementById("discardBtn");

const modalOverlay = document.getElementById("modalOverlay");
const modalDiff = document.getElementById("modalDiff");
const typeBlock = document.getElementById("typeBlock");
const typeList = document.getElementById("typeList");
const editWindowDelayNote = document.getElementById("editWindowDelayNote");
const countdownBlock = document.getElementById("countdownBlock");
const countdownEl = document.getElementById("countdown");
const modalStatus = document.getElementById("modalStatus");
const modalCancel = document.getElementById("modalCancel");
const modalConfirm = document.getElementById("modalConfirm");

let savedRules = [];
let savedConfig = null;
let countdownTimer = null;
let typedDomainsOk = false;

function newRuleId() {
  return "r_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function normalizeDomain(input) {
  let s = (input || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split("/")[0];
  s = s.split(":")[0];
  return s;
}

function parseDomains(text) {
  return (text || "")
    .split(/[\s,]+/)
    .map((d) => normalizeDomain(d))
    .filter(Boolean);
}

function showStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = "status " + (kind || "");
  if (text) {
    setTimeout(() => {
      if (statusEl.textContent === text) {
        statusEl.textContent = "";
        statusEl.className = "status";
      }
    }, 2000);
  }
}

// ---- DOM <-> draft ----
function readRuleEl(el) {
  return {
    id: el.dataset.ruleId || newRuleId(),
    name: el.querySelector(".rule-name").value.trim(),
    enabled: el.querySelector(".rule-enabled").checked,
    domains: parseDomains(el.querySelector(".rule-domains").value),
    ranges: [...el.querySelectorAll(".range")]
      .map((r) => ({
        start: r.querySelector(".range-start").value,
        end: r.querySelector(".range-end").value,
      }))
      .filter((r) => r.start && r.end),
  };
}

function collectDraftRules() {
  return [...rulesEl.querySelectorAll(".rule")]
    .map(readRuleEl)
    .filter((r) => r.domains.length > 0 && r.ranges.length > 0);
}

function collectDraftConfig() {
  return {
    ...savedConfig,
    editWindow: {
      start: editWinStart.value || DEFAULT_EDIT_WINDOW.start,
      end: editWinEnd.value || DEFAULT_EDIT_WINDOW.end,
    },
  };
}

// ---- 要素生成 ----
function addRangeEl(ruleEl, range) {
  const node = rangeTpl.content.firstElementChild.cloneNode(true);
  node.querySelector(".range-start").value = range?.start || "09:00";
  node.querySelector(".range-end").value = range?.end || "18:00";
  node.querySelector(".range-delete").addEventListener("click", () => {
    node.remove();
    onDraftChange();
  });
  node.querySelectorAll("input").forEach((i) => i.addEventListener("change", onDraftChange));
  ruleEl.querySelector(".ranges").appendChild(node);
}

function addRuleEl(rule) {
  const node = ruleTpl.content.firstElementChild.cloneNode(true);
  node.dataset.ruleId = rule?.id || newRuleId();
  node.querySelector(".rule-name").value = rule?.name || "";
  node.querySelector(".rule-enabled").checked = rule?.enabled ?? true;
  node.querySelector(".rule-domains").value = (rule?.domains || []).join("\n");

  const ranges = rule?.ranges?.length ? rule.ranges : [{ start: "09:00", end: "18:00" }];
  ranges.forEach((r) => addRangeEl(node, r));

  node.querySelector(".add-range").addEventListener("click", () => {
    addRangeEl(node, null);
    onDraftChange();
  });
  node.querySelector(".rule-delete").addEventListener("click", () => {
    node.remove();
    onDraftChange();
  });
  node.querySelector(".rule-name").addEventListener("input", onDraftChange);
  node.querySelector(".rule-enabled").addEventListener("change", onDraftChange);
  node.querySelector(".rule-domains").addEventListener("input", onDraftChange);
  rulesEl.appendChild(node);
  return node;
}

// ---- 編集窓 ----
function refreshEditWindowUI() {
  const nowMin = currentMinutes();
  const ew = savedConfig.editWindow;
  const inWindow = isInEditWindow(ew, nowMin);
  const untilChange = minutesUntilEditWindowChange(ew, nowMin);
  const h = Math.floor(untilChange / 60);
  const m = untilChange % 60;
  if (inWindow) {
    editWinHint.innerHTML = `現在 <strong>編集窓内</strong> です (${ew.start}〜${ew.end})。緩める変更が可能です。あと ${h}時間${m}分で閉まります。`;
    editWinHint.style.color = "var(--ok)";
  } else {
    editWinHint.innerHTML = `現在 <strong>編集窓外</strong> です。緩める変更ができません。次に開くまで <strong>${h}時間${m}分</strong> (${ew.start}〜${ew.end})。`;
    editWinHint.style.color = "var(--warn)";
  }
  if (savedConfig.pendingEditWindow) {
    const at = new Date(savedConfig.pendingEditWindow.effectiveAt);
    const p = savedConfig.pendingEditWindow.value;
    pendingBanner.hidden = false;
    pendingBanner.textContent = `編集窓は ${at.toLocaleString("ja-JP")} に「${p.start}〜${p.end}」へ変更されます。`;
  } else {
    pendingBanner.hidden = true;
  }
}

function applyLockState() {
  const nowMin = currentMinutes();
  const inWindow = isInEditWindow(savedConfig.editWindow, nowMin);
  document.querySelectorAll(".rule-delete, .range-delete").forEach((b) => {
    b.disabled = !inWindow;
    b.title = inWindow ? "" : "編集窓外: 緩める操作はできません";
  });
  const editingWindowAllowed = !savedConfig.editWindowEverChanged || inWindow;
  editWinStart.disabled = !editingWindowAllowed;
  editWinEnd.disabled = !editingWindowAllowed;
}

// ---- 差分 ----
function computeDiff() {
  const draftRules = collectDraftRules();
  const draftConfig = collectDraftConfig();
  const rulesDiff = classifyDiff(savedRules, draftRules);
  const ewKind = classifyEditWindowChange(savedConfig, draftConfig);
  const hasChange = rulesDiff.kind !== "none" || ewKind !== "none";
  const hasLax = rulesDiff.kind === "lax" || ewKind === "delayed";
  return { rulesDiff, ewKind, draftRules, draftConfig, hasChange, hasLax };
}

function onDraftChange() {
  const d = computeDiff();
  if (!d.hasChange) {
    saveBar.hidden = true;
    return;
  }
  saveBar.hidden = false;
  const parts = [];
  if (d.rulesDiff.strictDomains.length)
    parts.push(`厳格化: ${d.rulesDiff.strictDomains.length}ドメイン`);
  if (d.rulesDiff.laxDomains.length)
    parts.push(`緩和: ${d.rulesDiff.laxDomains.length}ドメイン`);
  if (d.ewKind === "first") parts.push("編集窓を初回設定");
  if (d.ewKind === "delayed") parts.push("編集窓を変更 (24h後)");
  saveBarSummary.textContent = parts.join(" / ");
}

// ---- 保存 ----
discardBtn.addEventListener("click", async () => {
  await renderAll();
  showStatus("変更を破棄しました", "ok");
});

saveBtn.addEventListener("click", async () => {
  const d = computeDiff();
  if (!d.hasChange) return;
  if (!d.hasLax) {
    await writeBack(d);
    return;
  }
  const nowMin = currentMinutes();
  const inWindow = isInEditWindow(savedConfig.editWindow, nowMin);
  const editingWindowAllowed = !savedConfig.editWindowEverChanged || inWindow;
  if (d.rulesDiff.kind === "lax" && !inWindow) {
    const until = minutesUntilEditWindowChange(savedConfig.editWindow, nowMin);
    const h = Math.floor(until / 60),
      m = until % 60;
    showStatus(
      `緩める変更は編集窓内 (${savedConfig.editWindow.start}〜${savedConfig.editWindow.end}) でのみ可能。あと ${h}時間${m}分。`,
      "err",
    );
    return;
  }
  if (d.ewKind === "delayed" && !editingWindowAllowed) {
    showStatus("編集窓自体の変更も編集窓内でのみ可能です。", "err");
    return;
  }
  openConfirmModal(d);
});

async function writeBack(diff) {
  let finalConfig = { ...savedConfig };
  if (diff.ewKind === "first") {
    finalConfig = {
      ...finalConfig,
      editWindow: { ...diff.draftConfig.editWindow },
      editWindowEverChanged: true,
      pendingEditWindow: null,
    };
  } else if (diff.ewKind === "delayed") {
    finalConfig = {
      ...finalConfig,
      pendingEditWindow: {
        value: { ...diff.draftConfig.editWindow },
        effectiveAt: Date.now() + EDIT_WINDOW_DELAY_MS,
      },
    };
  }
  await chrome.storage.local.set({
    [RULES_KEY]: diff.draftRules,
    [CONFIG_KEY]: finalConfig,
  });
  await renderAll();
  showStatus("保存しました", "ok");
}

// ---- 確認モーダル ----
function openConfirmModal(diff) {
  modalDiff.innerHTML = "";
  for (const [d, kind] of diff.rulesDiff.perDomain.entries()) {
    if (kind === "none") continue;
    const li = document.createElement("li");
    li.className = kind === "lax" || kind === "removed" ? "lax" : "strict";
    const label = { added: "追加", removed: "削除", lax: "緩和", strict: "厳格化" }[kind];
    li.textContent = `${d} — ${label}`;
    modalDiff.appendChild(li);
  }
  if (diff.ewKind === "first") {
    const li = document.createElement("li");
    li.textContent = `編集窓を ${diff.draftConfig.editWindow.start}〜${diff.draftConfig.editWindow.end} に初期設定`;
    modalDiff.appendChild(li);
  } else if (diff.ewKind === "delayed") {
    const li = document.createElement("li");
    li.className = "lax";
    li.textContent = `編集窓を ${diff.draftConfig.editWindow.start}〜${diff.draftConfig.editWindow.end} に変更 (24時間後)`;
    modalDiff.appendChild(li);
  }
  editWindowDelayNote.hidden = diff.ewKind !== "delayed";

  const targets = diff.rulesDiff.laxDomains;
  typeList.innerHTML = "";
  typedDomainsOk = targets.length === 0;
  if (targets.length === 0) {
    typeBlock.hidden = true;
  } else {
    typeBlock.hidden = false;
    targets.forEach((d) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.className = "domain-target";
      span.textContent = d;
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = d;
      input.autocomplete = "off";
      input.spellcheck = false;
      input.addEventListener("input", () => {
        if (input.value === d) li.classList.add("ok");
        else li.classList.remove("ok");
        typedDomainsOk = [...typeList.children].every((el) =>
          el.classList.contains("ok"),
        );
        modalConfirm.disabled = !typedDomainsOk;
      });
      li.appendChild(span);
      li.appendChild(input);
      typeList.appendChild(li);
    });
  }
  modalConfirm.disabled = !typedDomainsOk;
  modalStatus.textContent = "";
  countdownBlock.hidden = true;
  modalOverlay.hidden = false;
  modalConfirm.onclick = () => startCountdown(diff);
  modalCancel.onclick = () => closeModal();
}

function startCountdown(diff) {
  if (!typedDomainsOk) return;
  modalConfirm.disabled = true;
  modalCancel.textContent = "中止";
  countdownBlock.hidden = false;
  let remain = Math.ceil(LAX_APPLY_DELAY_MS / 1000);
  countdownEl.textContent = String(remain);
  countdownTimer = setInterval(async () => {
    remain -= 1;
    countdownEl.textContent = String(Math.max(remain, 0));
    if (remain <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      try {
        await writeBack(diff);
      } catch (e) {
        modalStatus.textContent = "失敗: " + e.message;
        modalStatus.className = "status err";
        return;
      }
      closeModal();
    }
  }, 1000);
}

function closeModal() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  modalOverlay.hidden = true;
  modalCancel.textContent = "キャンセル";
  modalConfirm.disabled = false;
}

// ---- ロード/マイグレーション ----
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
  savedRules = await migrateIfNeeded();
  const r = await chrome.storage.local.get(CONFIG_KEY);
  const stored = r[CONFIG_KEY] || {};
  savedConfig = {
    editWindow: stored.editWindow || { ...DEFAULT_EDIT_WINDOW },
    editWindowEverChanged: !!stored.editWindowEverChanged,
    pendingEditWindow: stored.pendingEditWindow || null,
  };
}

async function renderAll() {
  await loadAll();
  rulesEl.innerHTML = "";
  savedRules.forEach(addRuleEl);
  editWinStart.value = savedConfig.editWindow.start;
  editWinEnd.value = savedConfig.editWindow.end;
  refreshEditWindowUI();
  applyLockState();
  saveBar.hidden = true;
}

addRuleBtn.addEventListener("click", () => {
  const node = addRuleEl(null);
  node.querySelector(".rule-name").focus();
  onDraftChange();
});

editWinStart.addEventListener("change", onDraftChange);
editWinEnd.addEventListener("change", onDraftChange);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[CONFIG_KEY] || changes[RULES_KEY]) renderAll();
});

setInterval(() => {
  refreshEditWindowUI();
  applyLockState();
}, 30 * 1000);

renderAll();
