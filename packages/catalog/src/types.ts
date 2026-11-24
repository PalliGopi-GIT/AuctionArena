import type { AuctionMode, PlayerRole, PlayerTier } from '../../shared/src/domain';

export type Tier = PlayerTier;
export type CatalogRole = PlayerRole;

export interface CatalogPlayer {
  id: string;
  name: string;
  country: string;
  overseas: boolean;
  role: CatalogRole;
  tier: Tier;
  basePrice: number;
  marquee: boolean;
  battingStyle: string;
  bowlingStyle: string;
  image: string | null;
  imageStatus: 'bundled' | 'missing' | 'unconverted';
}

export interface Catalog {
  catalogVersion: string;
  source: string;
  generatedBy: string;
  players: CatalogPlayer[];
}

export interface PlanRules {
  teamCount: number;
  minSquad: number;
  maxSquad: number;
  maxOverseas: number;
}

export interface PlanSet {
  name: string;
  playerIds: string[];
}

export interface PlanAdjustment {
  code: string;
  message: string;
}

export interface PlanResult {
  ok: boolean;
  blockedReason?: string;
  poolIds: string[];
  sets: PlanSet[];
  adjustments: PlanAdjustment[];
}

export interface PlanRequest {
  catalog: CatalogPlayer[] | Catalog;
  mode: AuctionMode;
  seed: string;
  rules: PlanRules;
}

export interface AssetEntry {
  status: 'bundled' | 'missing' | 'unconverted';
  path: string | null;
  sourceFile: string | null;
  sourceBytes: number | null;
  sourceModified: number | null;
  outputBytes: number | null;
  width: number | null;
  height: number | null;
  license: string;
  provenance: string;
  credit: string;
}

export interface TeamLogoEntry {
  status: 'bundled' | 'unmatched';
  path: string | null;
  sourceFile: string | null;
  license: string;
  provenance: string;
  credit: string;
}

export interface AssetManifest {
  source: string;
  generatedBy: string;
  players: Record<string, AssetEntry>;
  missing: string[];
  unconverted: string[];
  ambiguous: string[];
  unmatchedFiles: string[];
  logos: {
    matched: Record<string, TeamLogoEntry>;
    unmatched: string[];
    provenance: string;
  };
}
