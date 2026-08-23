export const agencyConfig = {
  name: import.meta.env.VITE_AGENCY_NAME || 'BouSalem Agency',
  legalName: import.meta.env.VITE_AGENCY_LEGAL_NAME || '',
  phone: import.meta.env.VITE_AGENCY_PHONE || '',
  whatsapp: import.meta.env.VITE_AGENCY_WHATSAPP || '',
  email: import.meta.env.VITE_AGENCY_EMAIL || '',
  address: import.meta.env.VITE_AGENCY_ADDRESS || '',
  wilaya: import.meta.env.VITE_AGENCY_WILAYA || '',
  website: import.meta.env.VITE_AGENCY_WEBSITE || '',
  registrationNumber: import.meta.env.VITE_AGENCY_REGISTRATION_NUMBER || '',
  latitude: Number(import.meta.env.VITE_AGENCY_LATITUDE || '0'),
  longitude: Number(import.meta.env.VITE_AGENCY_LONGITUDE || '0'),
  timezone: import.meta.env.VITE_AGENCY_TIMEZONE || 'Africa/Algiers',
};
