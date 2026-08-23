/**
 * Kernel bridge for platform UI layers (slice 3).
 *
 * Provides the singleton PlatformKernel used by workspace surfaces and a tiny
 * React hook to read it. Lives outside the kernel/ directory so the kernel
 * itself stays framework-free.
 */

import { useMemo } from 'react';
import { PlatformKernel } from './kernel/index.ts';
import { LocalStorageWorkspaceStorage } from './kernel/workspaceRegistry.ts';

let singleton: PlatformKernel | null = null;

export function getPlatformKernel(): PlatformKernel {
  if (singleton === null) {
    singleton =
      typeof localStorage !== 'undefined'
        ? new PlatformKernel(new LocalStorageWorkspaceStorage())
        : new PlatformKernel();
  }
  return singleton;
}

export function usePlatformKernel(): PlatformKernel {
  return useMemo(() => getPlatformKernel(), []);
}

export type { PlatformKernel };
