const params = new URLSearchParams(location.search);
const domain = params.get("domain") || "";
document.getElementById("domain").textContent = domain || "(unknown)";

document.getElementById("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
