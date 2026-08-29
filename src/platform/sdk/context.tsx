/**
 * SDK context — how an app receives its runtime.
 *
 * The shell wraps every app window in `<AppRuntimeProvider>`. Apps read it
 * through `useApp()` and never see what is on the other side.
 */
import { createContext, type ReactNode } from 'react';
import type { AppRuntime } from './types';

export const AppRuntimeContext = createContext<AppRuntime | null>(null);

export function AppRuntimeProvider({
  runtime,
  children,
}: {
  runtime: AppRuntime;
  children: ReactNode;
}) {
  return <AppRuntimeContext.Provider value={runtime}>{children}</AppRuntimeContext.Provider>;
}
