export const WINDOWS_MAX_PATH: number;

export interface DoStatePathOptions {
  stateRoot: string;
  workerName: string;
  classNames: readonly string[];
  platform?: NodeJS.Platform;
  maxLength?: number;
}

export interface DoStatePathProblem {
  className: string;
  path: string;
  length: number;
  limit: number;
  message: string;
}

export function doObjectDirectory(stateRoot: string, workerName: string, className: string): string;
export function findDoStatePathProblem(options: DoStatePathOptions): DoStatePathProblem | null;
export function stripJsonComments(text: string): string;

export interface DurableObjectBinding {
  class_name?: string;
}

export interface WranglerConfig {
  name?: string;
  durable_objects?: { bindings?: DurableObjectBinding[] };
  env?: Record<string, { name?: string; durable_objects?: { bindings?: DurableObjectBinding[] } }>;
}

export function durableObjectClasses(
  config: WranglerConfig,
  environmentName?: string,
): { workerName: string; classNames: string[] };
