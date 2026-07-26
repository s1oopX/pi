import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(desktopDir));
const outputPath = join(repoRoot, "packages/coding-agent/dist/pi-studio-backend.exe");
const metafilePath = join(repoRoot, "packages/coding-agent/dist/pi-studio-backend.meta.json");
const customCompatPath = join(repoRoot, "packages/ai/src/custom-compat.ts");
const customOauthPath = join(repoRoot, "packages/ai/src/custom-oauth.ts");
const customProvidersAllPath = join(repoRoot, "packages/ai/src/custom-providers-all.ts");
const customTransportHeadersPath = join(repoRoot, "packages/ai/src/custom-transport-headers.ts");

const result = await Bun.build({
	entrypoints: [
		join(repoRoot, "packages/desktop/src/backend.ts"),
		join(repoRoot, "packages/coding-agent/src/utils/image-resize-worker.ts"),
	],
	target: "bun",
	compile: {
		outfile: outputPath,
		windows: { hideConsole: true },
	},
	metafile: true,
	plugins: [
		{
			name: "pi-studio-catalog-free-runtime",
			setup(build) {
				build.onResolve({ filter: /^@earendil-works\/pi-ai\/compat$/ }, () => ({ path: customCompatPath }));
				build.onResolve({ filter: /^@earendil-works\/pi-ai\/oauth$/ }, () => ({ path: customOauthPath }));
				build.onResolve({ filter: /^@earendil-works\/pi-ai\/providers\/all$/ }, () => ({
					path: customProvidersAllPath,
				}));
				build.onResolve({ filter: /^\.\/github-copilot-headers\.ts$/ }, () => ({
					path: customTransportHeadersPath,
				}));
			},
		},
	],
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	throw new Error("Failed to compile the Pi Studio backend");
}

await Bun.write(metafilePath, `${JSON.stringify(result.metafile, null, 2)}\n`);
console.log(`Compiled Pi Studio backend: ${outputPath}`);
