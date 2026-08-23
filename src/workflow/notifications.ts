export type NotificationChannel = 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP' | 'WHATSAPP';
export type NotificationPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type NotificationStatus = 'QUEUED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'DEAD_LETTER';

export type NotificationRequest = {
  recipient: string;
  template: string;
  payload?: Record<string, unknown>;
  channel: NotificationChannel;
  priority?: NotificationPriority;
};

export type NotificationPolicy = {
  channels: readonly NotificationChannel[];
  roles: readonly string[];
  escalationTimeoutMinutes: number;
};

export function validateNotificationRequest(request: NotificationRequest): NotificationRequest {
  const recipient = request.recipient.trim();
  const template = request.template.trim();
  if (!recipient) throw new Error('Recipient is required');
  if (!template) throw new Error('Template is required');
  return { ...request, recipient, template, payload: request.payload ?? {}, priority: request.priority ?? 'MEDIUM' };
}

export function getNotificationPolicy(_eventType: string, severity: string): NotificationPolicy {
  if (['CRITICAL', 'URGENT'].includes(severity.toUpperCase())) {
    return { channels: ['SMS', 'PUSH', 'IN_APP', 'WHATSAPP'], roles: ['MANAGER', 'ADMIN'], escalationTimeoutMinutes: 15 };
  }
  return { channels: ['IN_APP', 'EMAIL'], roles: ['AGENT'], escalationTimeoutMinutes: 120 };
}

export function deduplicateNotifications(notifications: NotificationRequest[]): NotificationRequest[] {
  const unique = new Map<string, NotificationRequest>();
  for (const request of notifications.map(validateNotificationRequest)) {
    const key = `${request.channel}:${request.recipient.toLowerCase()}:${request.template}:${JSON.stringify(request.payload ?? {})}`;
    if (!unique.has(key)) unique.set(key, request);
  }
  return [...unique.values()];
}


export function getNotificationIdempotencyKey(request: NotificationRequest, correlationId: string): string {
  const stablePayload = Object.keys(request.payload ?? {}).sort().map((key) => `${key}:${String(request.payload?.[key])}`).join('|');
  return `${correlationId}:${request.channel}:${request.recipient.trim().toLowerCase()}:${request.template}:${stablePayload}`;
}
