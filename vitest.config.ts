import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			"~": path.resolve(rootDir, "./src"),
		},
	},
	plugins: [
		cloudflareTest({
			// Minimal entry: DO class only (no TanStack Start / Solid SSR)
			main: "./tests/do/worker.ts",
			wrangler: { configPath: "./wrangler.jsonc" },
		}),
	],
	test: {
		include: ["tests/**/*.test.ts"],
	},
});
