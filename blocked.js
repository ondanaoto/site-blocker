const params = new URLSearchParams(location.search);
const domain = params.get("domain") || "";
document.getElementById("domain").textContent = domain || "(unknown)";

document.getElementById("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

function fmt(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}分`;
  return `${h}時間${m}分`;
}

function refresh() {
  chrome.runtime.sendMessage({ type: "getStatus" }, (res) => {
    const el = document.getElementById("countdown");
    if (chrome.runtime.lastError || !res || !res.editWindow) {
      el.hidden = true;
      return;
    }
    if (res.inWindow) {
      el.hidden = false;
      el.innerHTML = `現在は編集窓内です。あと <strong>${fmt(res.minutesUntilChange)}</strong> で閉まります。`;
    } else {
      el.hidden = false;
      el.innerHTML = `編集窓 (${res.editWindow.start}〜${res.editWindow.end}) まで、あと <strong>${fmt(res.minutesUntilChange)}</strong>。それまで設定を緩められません。`;
    }
  });
}

refresh();
setInterval(refresh, 30 * 1000);
