const THEME_STORAGE_KEY = "vignalise-theme-v1";
const themeToggle = document.querySelector("#theme-toggle");
const themeColor = document.querySelector('meta[name="theme-color"]');
const systemTheme = window.matchMedia("(prefers-color-scheme: light)");

function applyTheme(theme) {
  const isLight = theme === "light";
  document.documentElement.dataset.theme = isLight ? "light" : "dark";
  if (themeToggle) {
    themeToggle.setAttribute("aria-pressed", String(isLight));
    themeToggle.setAttribute("aria-label", `Switch to ${isLight ? "dark" : "light"} mode`);
    themeToggle.textContent = isLight ? "☾ Dark" : "☀ Light";
  }
  if (themeColor) themeColor.setAttribute("content", isLight ? "#f4f3ef" : "#11131b");
}

let savedTheme = null;
try {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") savedTheme = storedTheme;
} catch (error) {
  console.warn("Unable to read the saved theme preference:", error);
}

let hasUserPreference = savedTheme !== null;
applyTheme(savedTheme || (systemTheme.matches ? "light" : "dark"));

systemTheme.addEventListener("change", (event) => {
  if (!hasUserPreference) applyTheme(event.matches ? "light" : "dark");
});

themeToggle?.addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(theme);
  hasUserPreference = true;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    console.warn("Unable to save the theme preference:", error);
  }
});
