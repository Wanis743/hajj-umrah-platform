export type ResourceError = {
  message: string;
  code?: string;
  retryable?: boolean;
};
export type QueryStatus = 'idle' | 'loading' | 'success' | 'error' | 'refreshing';
