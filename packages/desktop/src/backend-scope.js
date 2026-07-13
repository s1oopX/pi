const forbiddenBackendInputs = [
	{ label: "generated model aggregator", pattern: /(^|[/\\])models\.generated\.[cm]?[jt]s$/i },
	{ label: "generated provider catalog", pattern: /(^|[/\\])providers[/\\][^/\\]+\.models\.[cm]?[jt]s$/i },
	{ label: "generated image catalog", pattern: /(^|[/\\])image-models\.generated\.[cm]?[jt]s$/i },
	{ label: "full compatibility entrypoint", pattern: /(^|[/\\])compat\.[cm]?[jt]s$/i },
	{
		label: "official OAuth implementation",
		pattern: /[/\\]utils[/\\]oauth[/\\](anthropic|github-copilot|openai-codex)\.[cm]?[jt]s$/i,
	},
	{ label: "official provider header adapter", pattern: /[/\\]api[/\\]github-copilot-headers\.[cm]?[jt]s$/i },
];

export function findForbiddenBackendInputs(inputs) {
	return inputs.flatMap((input) =>
		forbiddenBackendInputs
			.filter(({ pattern }) => pattern.test(input))
			.map(({ label }) => ({ input, label })),
	);
}

export function assertCatalogFreeBackendInputs(inputs) {
	const forbidden = findForbiddenBackendInputs(inputs);
	if (forbidden.length === 0) return;
	throw new Error(
		`Pi Studio backend included forbidden provider sources:\n${forbidden.map(({ input, label }) => `- ${label}: ${input}`).join("\n")}`,
	);
}
