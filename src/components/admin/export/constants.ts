import {
  Users, CalendarCheck, Wallet, UsersRound,
  BadgeCheck, FileBarChart,
} from 'lucide-react';
import { ExportModule } from './types';

export const EXPORT_MODULES: ExportModule[] = [
  {
    id: 'pilgrims', labelAr: 'الحجاج', labelFr: 'Pèlerins', labelEn: 'Pilgrims',
    icon: Users, table: 'pilgrims',
    fields: [
      { key: 'full_name', labelAr: 'الاسم الكامل', labelFr: 'Nom complet', labelEn: 'Full Name' },
      { key: 'passport_number', sensitive: true, labelAr: 'رقم الجواز', labelFr: 'N° Passeport', labelEn: 'Passport' },
      { key: 'phone', sensitive: true, labelAr: 'الهاتف', labelFr: 'Téléphone', labelEn: 'Phone' },
      { key: 'birth_date', labelAr: 'تاريخ الميلاد', labelFr: 'Date naissance', labelEn: 'DOB' },
      { key: 'wilaya', labelAr: 'الولاية', labelFr: 'Wilaya', labelEn: 'Wilaya' },
      { key: 'gender', labelAr: 'الجنس', labelFr: 'Sexe', labelEn: 'Gender' },
      { key: 'visa_status', labelAr: 'حالة التأشيرة', labelFr: 'Statut visa', labelEn: 'Visa Status' },
      { key: 'payment_status', labelAr: 'حالة الدفع', labelFr: 'Statut paiement', labelEn: 'Payment Status' },
      { key: 'status', labelAr: 'الحالة', labelFr: 'Statut', labelEn: 'Status' },
      { key: 'departure_airport', labelAr: 'مطار المغادرة', labelFr: 'Aéroport départ', labelEn: 'Airport' },
      { key: 'created_at', labelAr: 'تاريخ الإنشاء', labelFr: 'Date création', labelEn: 'Created At' },
    ],
  },
  {
    id: 'bookings', labelAr: 'الحجوزات', labelFr: 'Réservations', labelEn: 'Bookings',
    icon: CalendarCheck, table: 'bookings',
    fields: [
      { key: 'booking_reference', labelAr: 'رقم الحجز', labelFr: 'N° réservation', labelEn: 'Booking Ref' },
      { key: 'status', labelAr: 'الحالة', labelFr: 'Statut', labelEn: 'Status' },
      { key: 'amount_dzd', sensitive: true, labelAr: 'المبلغ (دج)', labelFr: 'Montant (DZD)', labelEn: 'Amount DZD' },
      { key: 'amount_sar', sensitive: true, labelAr: 'المبلغ (ر.س)', labelFr: 'Montant (SAR)', labelEn: 'Amount SAR' },
      { key: 'payment_method', labelAr: 'طريقة الدفع', labelFr: 'Mode paiement', labelEn: 'Payment Method' },
      { key: 'created_at', labelAr: 'تاريخ الحجز', labelFr: 'Date réservation', labelEn: 'Booked At' },
    ],
  },
  {
    id: 'payments', labelAr: 'المدفوعات', labelFr: 'Paiements', labelEn: 'Payments',
    icon: Wallet, table: 'payments',
    fields: [
      { key: 'amount_dzd', sensitive: true, labelAr: 'المبلغ (دج)', labelFr: 'Montant (DZD)', labelEn: 'Amount DZD' },
      { key: 'payment_method', labelAr: 'طريقة الدفع', labelFr: 'Mode paiement', labelEn: 'Method' },
      { key: 'payment_date', labelAr: 'تاريخ الدفع', labelFr: 'Date paiement', labelEn: 'Date' },
      { key: 'status', labelAr: 'الحالة', labelFr: 'Statut', labelEn: 'Status' },
      { key: 'notes', labelAr: 'ملاحظات', labelFr: 'Notes', labelEn: 'Notes' },
    ],
  },
  {
    id: 'groups', labelAr: 'المجموعات', labelFr: 'Groupes', labelEn: 'Groups',
    icon: UsersRound, table: 'groups',
    fields: [
      { key: 'code', labelAr: 'رمز الفوج', labelFr: 'Code groupe', labelEn: 'Group Code' },
      { key: 'name', labelAr: 'الاسم', labelFr: 'Nom', labelEn: 'Name' },
      { key: 'capacity', labelAr: 'الطاقة', labelFr: 'Capacité', labelEn: 'Capacity' },
      { key: 'departure_date', labelAr: 'تاريخ السفر', labelFr: 'Date départ', labelEn: 'Departure' },
      { key: 'status', labelAr: 'الحالة', labelFr: 'Statut', labelEn: 'Status' },
    ],
  },
  {
    id: 'visas', labelAr: 'التأشيرات', labelFr: 'Visas', labelEn: 'Visas',
    icon: BadgeCheck, table: 'visas',
    fields: [
      { key: 'visa_number', labelAr: 'رقم التأشيرة', labelFr: 'N° visa', labelEn: 'Visa Number' },
      { key: 'status', labelAr: 'الحالة', labelFr: 'Statut', labelEn: 'Status' },
      { key: 'application_date', labelAr: 'تاريخ التقديم', labelFr: 'Date demande', labelEn: 'Application Date' },
      { key: 'issue_date', labelAr: 'تاريخ الإصدار', labelFr: "Date d'émission", labelEn: 'Issue Date' },
      { key: 'expiry_date', labelAr: 'تاريخ الانتهاء', labelFr: "Date d'expiration", labelEn: 'Expiry Date' },
    ],
  },
  {
    id: 'external_operations', labelAr: 'العمليات الخارجية', labelFr: 'Opérations externes', labelEn: 'External Operations',
    icon: FileBarChart, table: 'external_operations',
    fields: [
      { key: 'provider', labelAr: 'الجهة', labelFr: 'Prestataire', labelEn: 'Provider' },
      { key: 'operation_type', labelAr: 'نوع العملية', labelFr: "Type d'opération", labelEn: 'Operation Type' },
      { key: 'internal_status', labelAr: 'الحالة الداخلية', labelFr: 'Statut interne', labelEn: 'Internal Status' },
      { key: 'external_reference', labelAr: 'المرجع الخارجي', labelFr: 'Référence externe', labelEn: 'External Ref' },
      { key: 'evidence_status', labelAr: 'حالة الأدلة', labelFr: "Statut preuves", labelEn: 'Evidence Status' },
      { key: 'sla_hours', labelAr: 'SLA (ساعة)', labelFr: 'SLA (heures)', labelEn: 'SLA Hours' },
    ],
  },
];
