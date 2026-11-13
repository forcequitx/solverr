/** Browser storage key for the light or dark choice made with a dark mode switch. */
export const THEME_STORAGE_KEY = "solverr-theme";

/** Runs before the first paint so a saved choice applies without a flash; without one, the system setting applies. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

/** The same as `THEME_INIT_SCRIPT`, for client code that rebuilds <html> after the script ran. */
export function applySavedTheme(): void {
  try {
    const theme = localStorage.getItem(THEME_STORAGE_KEY);
    if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
  } catch {
    /** Storage can be blocked; the system setting applies then. */
  }
}
