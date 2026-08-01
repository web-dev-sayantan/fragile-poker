import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/solid-router";
import { TanStackRouterDevtools } from "@tanstack/solid-router-devtools";
import "@fontsource-variable/dm-sans";
import { Suspense } from "solid-js";
import { HydrationScript } from "solid-js/web";
import { ThemeToggle } from "~/components/ui/theme-toggle";
import styleCss from "../styles.css?url";

const themeBootstrapScript = `(() => {
  const stored = localStorage.getItem("fragile-poker-theme");
  const theme = stored === "light" || stored === "dark"
    ? stored
    : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
  document.documentElement.style.colorScheme = theme;
})();`;

export const Route = createRootRouteWithContext()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{
				name: "description",
				content:
					"Fast planning poker for agile teams. Create a room, share the link, vote privately, reveal together.",
			},
			{ name: "theme-color", content: "#faf8f5" },
			{ title: "Fragile Poker" },
		],
		links: [{ rel: "stylesheet", href: styleCss }],
	}),
	shellComponent: RootComponent,
});

function RootComponent() {
	return (
		<html lang="en">
			<head>
				<HydrationScript />
				<script>{themeBootstrapScript}</script>
				<HeadContent />
			</head>
			<body class="min-h-dvh bg-background text-foreground antialiased">
				<ThemeToggle />
				<Suspense>
					<Outlet />
					<TanStackRouterDevtools position="bottom-right" />
				</Suspense>
				<Scripts />
			</body>
		</html>
	);
}
