const listEl = document.getElementById("activeList");
const winEl = document.getElementById("windowInfo");

function fmt(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h === 0 ? `${m}分` : `${h}時間${m}分`;
}

chrome.runtime.sendMessage({ type: "getStatus" }, (res) => {
  listEl.innerHTML = "";
  if (chrome.runtime.lastError || !res) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "状態を取得できませんでした";
    listEl.appendChild(li);
    return;
  }
  const active = Array.isArray(res.active) ? res.active : [];
  res.active = active;

  if (active.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = res.total === 0 ? "サイトが未登録です" : "現在ブロック中のサイトはありません";
    listEl.appendChild(li);
  } else {
    res.active.forEach((d) => {
      const li = document.createElement("li");
      li.textContent = d;
      listEl.appendChild(li);
    });
  }

  const ew = res.editWindow;
  if (!ew) {
    winEl.textContent = "—";
  } else if (res.inWindow) {
    winEl.innerHTML = `<span class="ok">編集窓内</span> (${ew.start}〜${ew.end}) — あと ${fmt(res.minutesUntilChange)}で閉まります`;
  } else {
    winEl.innerHTML = `<span class="warn">編集窓外</span> — 次は ${ew.start}〜${ew.end} (あと ${fmt(res.minutesUntilChange)})`;
  }
});

document.getElementById("settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
