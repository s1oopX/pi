/**
 * Catalog-free `providers/all` entry for Pi Studio.
 *
 * The desktop backend build aliases `@earendil-works/pi-ai/providers/all` to
 * this module so no generated provider catalogs, official providers, or
 * gateway integrations are bundled. Models come exclusively from the user's
 * models.json.
 */

import { createImagesModels, type ImagesProvider, type MutableImagesModels } from "./images-models.ts";
import { type CreateModelsOptions, createModels, type MutableModels, type Provider } from "./models.ts";
import type { Api, Model } from "./types.ts";

const EMPTY_MODELS = {} as const;

export function radiusProvider(_options?: { id?: string; name?: string; gateway?: string }): Provider {
	throw new Error("Radius gateway providers are not available in the Pi Studio backend");
}

export type BuiltinProvider = keyof typeof EMPTY_MODELS;

export function getBuiltinModel(_provider: string, _modelId: string): Model<Api> | undefined {
	return undefined;
}

export function getBuiltinProviders(): BuiltinProvider[] {
	return [];
}

export function getBuiltinModelDataGeneratedAt(): number | undefined {
	return undefined;
}

export function getBuiltinModels(_provider: string): Model<Api>[] {
	return [];
}

export function builtinProviders(): Provider[] {
	return [];
}

export function builtinModels(options?: CreateModelsOptions): MutableModels {
	return createModels(options);
}

export function builtinImagesProviders(): ImagesProvider[] {
	return [];
}

export function builtinImagesModels(options?: CreateModelsOptions): MutableImagesModels {
	return createImagesModels(options);
}
