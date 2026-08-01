import { Moon, Sun } from "lucide-solid";
import { createSignal, onCleanup, onMount } from "solid-js";
import {
	applyTheme,
	getStoredTheme,
	getSystemTheme,
	THEME_STORAGE_KEY,
	type Theme,
} from "~/lib/theme";

export function ThemeToggle() {
	const [theme, setTheme] = createSignal<Theme>("light");

	onMount(() => {
		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

		const syncTheme = () => {
			if (getStoredTheme()) {
				return;
			}
			const nextTheme = getSystemTheme();
			setTheme(nextTheme);
			applyTheme(nextTheme);
		};

		syncTheme();
		mediaQuery.addEventListener("change", syncTheme);
		onCleanup(() => mediaQuery.removeEventListener("change", syncTheme));
	});

	const toggleTheme = () => {
		const nextTheme = theme() === "dark" ? "light" : "dark";
		window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
		setTheme(nextTheme);
		applyTheme(nextTheme);
	};

	return (
		<button
			type="button"
			class="fixed bottom-4 right-4 z-20 inline-flex size-10 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground sm:bottom-auto sm:right-6 sm:top-6"
			aria-label={
				theme() === "dark" ? "Switch to light mode" : "Switch to dark mode"
			}
			title={
				theme() === "dark" ? "Switch to light mode" : "Switch to dark mode"
			}
			onClick={toggleTheme}
		>
			{theme() === "dark" ? (
				<Sun size={18} strokeWidth={1.75} aria-hidden="true" />
			) : (
				<Moon size={18} strokeWidth={1.75} aria-hidden="true" />
			)}
		</button>
	);
}
