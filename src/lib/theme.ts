export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "fragile-poker-theme";

export function getSystemTheme(): Theme {
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

export function getStoredTheme(): Theme | null {
	const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
	return stored === "light" || stored === "dark" ? stored : null;
}

export function applyTheme(theme: Theme) {
	document.documentElement.classList.toggle("dark", theme === "dark");
	document.documentElement.classList.toggle("light", theme === "light");
	document.documentElement.style.colorScheme = theme;
}
