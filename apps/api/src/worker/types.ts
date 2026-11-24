import type { User } from '../../../../packages/shared/src/domain';

/** Structural types keep this entry independent of @cloudflare/workers-types. */
export interface DurableObjectIdLike { toString(): string }
export interface DurableObjectStubLike { fetch(request: Request): Promise<Response> }
export interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): DurableObjectStubLike;
}
export interface AssetsLike { fetch(request: Request): Promise<Response> }
export interface WorkerEnv {
  ROOM: DurableObjectNamespaceLike;
  ASSETS: AssetsLike;
  /** Optional so package C behaviour remains testable without a directory. */
  DIRECTORY?: DurableObjectNamespaceLike;
  CLERK_SECRET_KEY?: string;
  CLERK_JWT_KEY?: string;
  CLERK_ISSUER?: string;
  ALLOWED_ORIGINS?: string;
  WS_TICKET_SECRET?: string;
  LOCAL_BID_TIMING?: string;
}
export interface VerifiedIdentity extends User { firstFactorAge?: number }
export interface WorkerVariables { user: User; requestId: string; firstFactorAge?: number }
export type WorkerContext = { Bindings: WorkerEnv; Variables: WorkerVariables };
export type IdentityVerifier = (token: string, env: WorkerEnv) => Promise<VerifiedIdentity>;
