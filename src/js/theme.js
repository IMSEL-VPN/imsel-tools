const themeSelect = document.getElementById("theme-select");

if (themeSelect) {
  const root = document.documentElement;
  const validTheme = value => ["system", "light", "dark"].includes(value);
  themeSelect.value = validTheme(root.dataset.theme) ? root.dataset.theme : "system";

  themeSelect.addEventListener("change", () => {
    const theme = validTheme(themeSelect.value) ? themeSelect.value : "system";
    themeSelect.value = theme;
    root.dataset.theme = theme;
    try {
      localStorage.setItem("imsel-tools-theme", theme);
    } catch {}
  });
}
