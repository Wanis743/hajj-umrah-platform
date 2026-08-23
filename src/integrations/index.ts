export type IntegrationChannel = 'email' | 'sms' | 'whatsapp' | 'push' | 'sentry' | 'airline' | 'bank';

export type IntegrationStatus = {
  channel: IntegrationChannel;
  configured: boolean;
  provider?: string;
};

// Browser-safe metadata only. Secrets and actual provider adapters live server-side.
const publicProviderNames: Partial<Record<IntegrationChannel, string>> = {
  email: import.meta.env.VITE_EMAIL_PROVIDER_NAME,
  sms: import.meta.env.VITE_SMS_PROVIDER_NAME,
  whatsapp: import.meta.env.VITE_WHATSAPP_PROVIDER_NAME,
  push: import.meta.env.VITE_PUSH_PROVIDER_NAME,
};

export function getIntegrationStatus(channel: IntegrationChannel): IntegrationStatus {
  const provider = publicProviderNames[channel];
  return { channel, configured: Boolean(provider), provider };
}

export const SERVER_INTEGRATION_SECRETS = {
  email: 'EMAIL_API_KEY',
  sms: 'SMS_API_KEY',
  whatsapp: 'WHATSAPP_API_KEY',
  push: 'PUSH_API_KEY',
  sentry: 'SENTRY_DSN',
  airline: 'AIRLINE_API_KEY',
  bank: 'BANK_API_KEY',
} as const;

export function assertServerOnlySecretUsage(): typeof SERVER_INTEGRATION_SECRETS {
  return SERVER_INTEGRATION_SECRETS;
}
