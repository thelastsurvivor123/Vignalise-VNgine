const homeMenuToggle = document.querySelector("#home-menu-toggle");
const homeMenuItems = document.querySelector("#home-menu-items");

homeMenuToggle?.addEventListener("click", () => {
  const isOpen = homeMenuItems.classList.toggle("open");
  homeMenuToggle.setAttribute("aria-expanded", String(isOpen));
  homeMenuToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
});

homeMenuItems?.addEventListener("click", (event) => {
  if (event.target.closest("a")) {
    homeMenuItems.classList.remove("open");
    homeMenuToggle.setAttribute("aria-expanded", "false");
    homeMenuToggle.setAttribute("aria-label", "Open menu");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && homeMenuItems?.classList.contains("open")) {
    homeMenuItems.classList.remove("open");
    homeMenuToggle.setAttribute("aria-expanded", "false");
    homeMenuToggle.setAttribute("aria-label", "Open menu");
    homeMenuToggle.focus();
  }
});
