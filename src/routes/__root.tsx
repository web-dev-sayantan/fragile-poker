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
import styleCss from "../styles.css?url";

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
				<HeadContent />
			</head>
			<body class="min-h-dvh bg-background text-foreground antialiased">
				<Suspense>
					<Outlet />
					<TanStackRouterDevtools position="bottom-right" />
				</Suspense>
				<Scripts />
			</body>
		</html>
	);
}
