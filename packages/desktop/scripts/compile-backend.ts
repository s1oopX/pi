import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(desktopDir));
const backendEntryPath = join(repoRoot, "packages/desktop/src/backend.ts");
const outputPath = join(repoRoot, "packages/coding-agent/dist/pi-studio-backend.exe");
const metafilePath = join(repoRoot, "packages/coding-agent/dist/pi-studio-backend.meta.json");
const remoteOutputPath = join(repoRoot, "packages/coding-agent/dist/pi-studio-remote.mjs");
const remoteMetafilePath = join(repoRoot, "packages/coding-agent/dist/pi-studio-remote.meta.json");
const customCompatPath = join(repoRoot, "packages/ai/src/custom-compat.ts");
const customOauthPath = join(repoRoot, "packages/ai/src/custom-oauth.ts");
const customProvidersAllPath = join(repoRoot, "packages/ai/src/custom-providers-all.ts");
const customTransportHeadersPath = join(repoRoot, "packages/ai/src/custom-transport-headers.ts");

function catalogFreePlugin() {
	return {
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
	};
}

const result = await Bun.build({
	entrypoints: [
		backendEntryPath,
		join(repoRoot, "packages/coding-agent/src/utils/image-resize-worker.ts"),
	],
	target: "bun",
	compile: {
		outfile: outputPath,
		windows: { hideConsole: true },
	},
	metafile: true,
	plugins: [catalogFreePlugin()],
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	throw new Error("Failed to compile the Pi Studio backend");
}

await Bun.write(metafilePath, `${JSON.stringify(result.metafile, null, 2)}\n`);

const remoteResult = await Bun.build({
	entrypoints: [backendEntryPath],
	target: "node",
	format: "esm",
	write: false,
	metafile: true,
	external: ["@silvia-odwyer/photon-node"],
	plugins: [catalogFreePlugin()],
});

if (!remoteResult.success) {
	for (const log of remoteResult.logs) console.error(log);
	throw new Error("Failed to bundle the Pi Studio remote backend");
}
if (remoteResult.outputs.length !== 1) {
	throw new Error(`Expected one Pi Studio remote backend output, got ${remoteResult.outputs.length}`);
}

await Bun.write(remoteOutputPath, remoteResult.outputs[0]);
await Bun.write(remoteMetafilePath, `${JSON.stringify(remoteResult.metafile, null, 2)}\n`);
console.log(`Compiled Pi Studio backends: ${outputPath}, ${remoteOutputPath}`);
