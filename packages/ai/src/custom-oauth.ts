/** Catalog-free OAuth registry for Pi Studio. */

export * from "./utils/oauth/types.ts";

import type {
	OAuthCredentials,
	OAuthProviderId,
	OAuthProviderInfo,
	OAuthProviderInterface,
} from "./utils/oauth/types.ts";

const oauthProviderRegistry = new Map<string, OAuthProviderInterface>();

export function getOAuthProvider(id: OAuthProviderId): OAuthProviderInterface | undefined {
	return oauthProviderRegistry.get(id);
}

export function registerOAuthProvider(provider: OAuthProviderInterface): void {
	oauthProviderRegistry.set(provider.id, provider);
}

export function unregisterOAuthProvider(id: string): void {
	oauthProviderRegistry.delete(id);
}

export function resetOAuthProviders(): void {
	oauthProviderRegistry.clear();
}

export function getOAuthProviders(): OAuthProviderInterface[] {
	return Array.from(oauthProviderRegistry.values());
}

export function getOAuthProviderInfoList(): OAuthProviderInfo[] {
	return getOAuthProviders().map((provider) => ({
		id: provider.id,
		name: provider.name,
		available: true,
	}));
}

export async function refreshOAuthToken(
	providerId: OAuthProviderId,
	credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
	const provider = getOAuthProvider(providerId);
	if (!provider) {
		throw new Error(`Unknown custom OAuth provider: ${providerId}`);
	}
	return provider.refreshToken(credentials);
}

export async function getOAuthApiKey(
	providerId: OAuthProviderId,
	credentials: Record<string, OAuthCredentials>,
): Promise<{ newCredentials: OAuthCredentials; apiKey: string } | null> {
	const provider = getOAuthProvider(providerId);
	if (!provider) {
		throw new Error(`Unknown custom OAuth provider: ${providerId}`);
	}

	let current = credentials[providerId];
	if (!current) return null;
	if (Date.now() >= current.expires) {
		current = await provider.refreshToken(current);
	}
	return { newCredentials: current, apiKey: provider.getApiKey(current) };
}
