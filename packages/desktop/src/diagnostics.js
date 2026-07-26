/**
 * @param {unknown} value
 * @param {string} homePath
 * @param {number} [depth]
 * @returns {unknown}
 */
export function sanitizeDiagnostics(value, homePath, depth = 0) {
	if (depth > 10) return "<max-depth>";
	if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeDiagnostics(item, homePath, depth + 1));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.slice(0, 300)
				.map(([key, item]) => [
					key,
					/api[-_]?key|authorization|token|secret|password|cookie/i.test(key)
						? "<redacted>"
						: sanitizeDiagnostics(item, homePath, depth + 1),
				]),
		);
	}
	if (typeof value !== "string") return value;
	return value
		.replaceAll(homePath, "<home>")
		.replaceAll(homePath.replaceAll("\\", "/"), "<home>")
		.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "<authorization redacted>")
		.replace(/\b(?:sk|key|token)-[A-Za-z0-9_-]{12,}\b/gi, "<redacted>")
		.replace(/((?:api[-_]?key|token|secret|password)\s*[:=]\s*)["']?[^,\s"']+/gi, "$1<redacted>")
		.replace(/([?&](?:api_?key|key|token|secret|signature|sig)=)[^&\s]+/gi, "$1<redacted>");
}
