export type Booking = {
  id: string;
  pilgrimId: string;
  packageId: string;
  status: string;
  options: Record<string, unknown>;
  createdAt: Date;
};

export type PricingSnapshot = {
  total: number;
  currency: string;
  lineItems: { description: string; amount: number }[];
};

export function createBooking(): never {
  throw new Error('Bookings must be created through the server-side reservation/booking workflow');
}

export function calculatePrice(): never {
  throw new Error('Pricing must be read from the active package configuration');
}

export function processPayment(): never {
  throw new Error('Payments must be recorded through public.record_payment_transaction');
}

export function cancelBooking(): never {
  throw new Error('Cancellations must be processed through the server-side cancellation workflow');
}

export function getBookingTimeline(): never {
  throw new Error('Booking timelines must be queried from persisted events/audit history');
}
