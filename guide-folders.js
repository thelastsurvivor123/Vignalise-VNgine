const desktopGuideLayout = window.matchMedia("(min-width: 681px)");

function updateGuideRowState(row) {
  const [first, second] = row.querySelectorAll(".guide-folder-toggle");
  row.classList.toggle("is-open-left", first?.getAttribute("aria-expanded") === "true");
  row.classList.toggle("is-open-right", second?.getAttribute("aria-expanded") === "true");
}

document.querySelectorAll(".guide-folder-toggle").forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const panel = document.getElementById(toggle.getAttribute("aria-controls"));
    if (!panel) return;
    const isExpanded = toggle.getAttribute("aria-expanded") !== "true";
    const row = toggle.closest(".guide-row");
    if (isExpanded && desktopGuideLayout.matches && row) {
      row.querySelectorAll(".guide-folder-toggle").forEach((peer) => {
        if (peer === toggle) return;
        const peerPanel = document.getElementById(peer.getAttribute("aria-controls"));
        peer.setAttribute("aria-expanded", "false");
        peer.classList.remove("is-open");
        if (peerPanel) peerPanel.hidden = true;
      });
    }
    toggle.setAttribute("aria-expanded", String(isExpanded));
    toggle.classList.toggle("is-open", isExpanded);
    panel.hidden = !isExpanded;
    if (row) updateGuideRowState(row);
  });
});
