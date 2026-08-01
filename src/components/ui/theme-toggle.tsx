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
				<svg
					viewBox="0 0 24 24"
					width="18"
					height="18"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<circle cx="12" cy="12" r="4" />
					<path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
				</svg>
			) : (
				<svg
					viewBox="0 0 24 24"
					width="18"
					height="18"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
				</svg>
			)}
		</button>
	);
}
