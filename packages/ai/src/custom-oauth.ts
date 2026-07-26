/**
 * Catalog-free OAuth entry point for Pi Studio.
 *
 * Mirrors upstream `oauth.ts`: since 0.82 the `/oauth` entry is type-only
 * (extension OAuth declarations); no official provider OAuth implementations
 * are bundled into the Studio backend.
 */
export type {
	OAuthAuthInfo,
	OAuthCredentials,
	OAuthDeviceCodeInfo,
	OAuthLoginCallbacks,
	OAuthPrompt,
	OAuthSelectOption,
	OAuthSelectPrompt,
} from "./compat/extension-oauth-types.ts";
