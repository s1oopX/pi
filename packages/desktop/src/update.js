const RELEASE_API_URL = "https://api.github.com/repos/s1oopX/pi/releases/latest";
const RELEASE_PAGE_PREFIX = "/s1oopX/pi/releases/";
const RELEASE_DOWNLOAD_PREFIX = `${RELEASE_PAGE_PREFIX}download/`;
const DEFAULT_TIMEOUT_MS = 10000;

function parseVersion(value) {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value).trim());
	if (!match) return undefined;
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4],
	};
}

export function isNewerDesktopVersion(candidateVersion, currentVersion) {
	const candidate = parseVersion(candidateVersion);
	const current = parseVersion(currentVersion);
	if (!candidate || !current) return false;
	for (const part of ["major", "minor", "patch"]) {
		if (candidate[part] !== current[part]) return candidate[part] > current[part];
	}
	return Boolean(current.prerelease) && !candidate.prerelease;
}

function validateReleaseUrl(value) {
	const url = new URL(String(value));
	if (
		url.protocol !== "https:" ||
		url.hostname !== "github.com" ||
		url.username ||
		url.password ||
		url.port ||
		!url.pathname.startsWith(RELEASE_PAGE_PREFIX)
	) {
		throw new Error("The update service returned an unexpected release URL");
	}
	return url.toString();
}

function getDesktopDownloadUrl(release, tagName, version) {
	const assetName = `PiStudio-${version}.exe`;
	const asset = Array.isArray(release.assets)
		? release.assets.find((candidate) => candidate && typeof candidate === "object" && candidate.name === assetName)
		: undefined;
	if (!asset) return null;

	const url = new URL(String(asset.browser_download_url));
	const expectedPath = `${RELEASE_DOWNLOAD_PREFIX}${encodeURIComponent(tagName)}/${encodeURIComponent(assetName)}`;
	if (
		url.protocol !== "https:" ||
		url.hostname !== "github.com" ||
		url.username ||
		url.password ||
		url.port ||
		url.pathname !== expectedPath ||
		url.search ||
		url.hash
	) {
		throw new Error("The update service returned an unexpected desktop download URL");
	}
	return url.toString();
}

export async function checkDesktopUpdate(currentVersion, options = {}) {
	const fetchImpl = options.fetchImpl ?? fetch;
	const response = await fetchImpl(RELEASE_API_URL, {
		headers: {
			accept: "application/vnd.github+json",
			"User-Agent": `Pi-Studio/${currentVersion}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
		redirect: "error",
		signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
	});
	if (response.status === 404) {
		return { currentVersion, published: false, available: false };
	}
	if (!response.ok) {
		throw new Error(`Update service returned HTTP ${response.status}`);
	}
	const release = await response.json();
	if (!release || typeof release !== "object" || release.draft || release.prerelease) {
		throw new Error("The update service returned an invalid release");
	}
	const tagName = typeof release.tag_name === "string" ? release.tag_name.trim() : "";
	const latestVersion = tagName.replace(/^v/, "");
	if (!parseVersion(latestVersion)) {
		throw new Error("The update service returned an invalid version");
	}
	const releaseUrl = validateReleaseUrl(release.html_url);
	const downloadUrl = getDesktopDownloadUrl(release, tagName, latestVersion);
	return {
		currentVersion,
		published: true,
		available: isNewerDesktopVersion(latestVersion, currentVersion),
		latestVersion,
		releaseUrl,
		downloadUrl,
	};
}
