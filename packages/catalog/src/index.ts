import catalogData from './data/catalog.json';
import assetsData from './data/assets.json';
import type { AssetManifest, Catalog } from './types';

export const catalog = catalogData as Catalog;
export const assetManifest = assetsData as AssetManifest;
export * from './types';
export * from './planner';
export * from './room-plan';
