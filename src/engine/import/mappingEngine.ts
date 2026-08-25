/**
 * Column Mapping Engine — Intelligent synonym-based field matching.
 * Suggests mappings from source columns to target schema fields.
 * Confidence: 0–100 (100 = exact match, 0 = no match).
 */

export interface FieldDefinition {
  key: string;         // target field name, e.g. 'full_name'
  type: 'string' | 'phone' | 'date' | 'currency' | 'arabic' | 'passport' | 'email' | 'integer' | 'boolean';
  required: boolean;
  labelAr: string;
  labelFr: string;
  labelEn: string;
  examples?: string[];
}

export interface ColumnMapping {
  sourceColumn: string;
  targetField: string | null;
  confidence: number;
  matchReason: 'exact' | 'alias' | 'similarity' | 'type_inference' | 'manual' | 'unmapped';
  transformation?: string | undefined;
}

// Synonym Dictionary

const SYNONYMS: Record<string, string[]> = {
  full_name: [
    'name', 'full name', 'nom', 'nom complet', 'الاسم الكامل', 'الاسم', 'nom et prénom',
    'fullname', 'pilgrim name', 'customer name', 'client', 'اسم الحاج',
  ],
  full_name_ar: [
    'nom arabe', 'arabic name', 'الاسم بالعربية', 'name ar', 'nom_ar',
    'الاسم العربي', 'اسم عربي',
  ],
  passport_number: [
    'passport', 'passport no', 'passport number', 'passeport', 'n° passeport',
    'رقم الجواز', 'رقم جواز السفر', 'جواز', 'جواز السفر', 'passport_no',
  ],
  phone: [
    'tel', 'telephone', 'téléphone', 'mobile', 'mobile phone', 'phone number',
    'هاتف', 'رقم الهاتف', 'الجوال', 'الهاتف المحمول', 'gsm', 'téléphone mobile',
    'téléphone portable',
  ],
  email: [
    'email', 'e-mail', 'mail', 'البريد الإلكتروني', 'إيميل', 'courriel',
    'adresse email',
  ],
  birth_date: [
    'dob', 'date of birth', 'birthdate', 'date naissance', 'born', 'birthday',
    'تاريخ الميلاد', 'الميلاد', 'تاريخ الولادة',
  ],
  nationality: [
    'nationality', 'nationalité', 'country', 'الجنسية', 'جنسية',
  ],
  wilaya: [
    'wilaya', 'province', 'état', 'الولاية', 'المنطقة', 'region',
  ],
  gender: [
    'gender', 'sexe', 'sex', 'الجنس', 'ذكر/أنثى', 'm/f',
  ],
  departure_airport: [
    'airport', 'departure', 'aéroport', 'مطار المغادرة', 'مطار', 'departure airport',
    'aeroport depart',
  ],
  package_id: [
    'package', 'package name', 'forfait', 'programme', 'الباقة', 'اسم الباقة',
    'package code',
  ],
  group_id: [
    'group', 'groupe', 'fawj', 'الفوج', 'المجموعة', 'group name', 'group code',
  ],
  payment_status: [
    'payment', 'payment status', 'statut paiement', 'حالة الدفع', 'الدفع',
  ],
  visa_status: [
    'visa', 'visa status', 'statut visa', 'حالة التأشيرة', 'التأشيرة',
  ],
  status: [
    'status', 'statut', 'état', 'الحالة', 'حالة',
  ],
  emergency_contact: [
    'emergency', 'emergency contact', 'contact urgence', 'جهة الطوارئ',
    'contact d\'urgence', 'رقم الطوارئ',
  ],
  // Booking fields
  booking_reference: [
    'ref', 'reference', 'booking ref', 'رقم الحجز', 'مرجع الحجز', 'booking number',
  ],
  amount: [
    'amount', 'montant', 'price', 'prix', 'cost', 'المبلغ', 'السعر', 'التكلفة',
    'total', 'total amount',
  ],
  payment_method: [
    'method', 'payment method', 'méthode de paiement', 'طريقة الدفع', 'وسيلة الدفع',
    'mode paiement', 'mode de paiement',
  ],
  notes: [
    'notes', 'note', 'remarque', 'observation', 'ملاحظات', 'ملاحظة', 'commentaire',
  ],
};

// Similarity Functions

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_\-.]/g, '').trim();
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter(c => setB.has(c)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function stringSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 85;
  return jaccardSimilarity(na, nb) * 70;
}

// Mapping Engine

export function detectColumnMapping(
  sourceColumns: string[],
  targetFields: FieldDefinition[],
  _sampleData?: Record<string, unknown[]>,
): ColumnMapping[] {
  return sourceColumns.map(col => {
    let bestMatch: string | null = null;
    let bestScore = 0;
    let bestReason: ColumnMapping['matchReason'] = 'unmapped';
    let transformation: string | undefined;

    const colNorm = normalize(col);

    for (const field of targetFields) {
      // 1. Exact key match
      if (colNorm === normalize(field.key)) {
        return {
          sourceColumn: col,
          targetField: field.key,
          confidence: 100,
          matchReason: 'exact',
        };
      }

      // 2. Synonym match
      const synonyms = SYNONYMS[field.key] ?? [];
      const synonymMatch = synonyms.find(syn => normalize(syn) === colNorm);
      if (synonymMatch) {
        if (95 > bestScore) {
          bestScore = 95;
          bestMatch = field.key;
          bestReason = 'alias';
        }
        continue;
      }

      // 3. Label match (Arabic/French/English)
      const labelMatch = [field.labelAr, field.labelFr, field.labelEn]
        .some(label => normalize(label) === colNorm);
      if (labelMatch && 92 > bestScore) {
        bestScore = 92;
        bestMatch = field.key;
        bestReason = 'alias';
        continue;
      }

      // 4. String similarity
      const simScore = Math.max(
        stringSimilarity(col, field.key),
        stringSimilarity(col, field.labelEn),
        stringSimilarity(col, field.labelFr),
        stringSimilarity(col, field.labelAr),
        ...synonyms.map(syn => stringSimilarity(col, syn)),
      );

      if (simScore > bestScore && simScore > 50) {
        bestScore = simScore;
        bestMatch = field.key;
        bestReason = 'similarity';
      }
    }

    return {
      sourceColumn: col,
      targetField: bestMatch,
      confidence: Math.round(bestScore),
      matchReason: bestMatch ? bestReason : 'unmapped',
      transformation,
    };
  });
}

// Pre-defined field schemas for each module

export const PILGRIM_FIELDS: FieldDefinition[] = [
  { key: 'full_name', type: 'string', required: true, labelAr: 'الاسم الكامل', labelFr: 'Nom complet', labelEn: 'Full Name' },
  { key: 'full_name_ar', type: 'arabic', required: false, labelAr: 'الاسم بالعربية', labelFr: 'Nom en arabe', labelEn: 'Arabic Name' },
  { key: 'passport_number', type: 'passport', required: true, labelAr: 'رقم جواز السفر', labelFr: 'N° Passeport', labelEn: 'Passport Number' },
  { key: 'phone', type: 'phone', required: false, labelAr: 'الهاتف', labelFr: 'Téléphone', labelEn: 'Phone' },
  { key: 'email', type: 'email', required: false, labelAr: 'البريد الإلكتروني', labelFr: 'Email', labelEn: 'Email' },
  { key: 'birth_date', type: 'date', required: false, labelAr: 'تاريخ الميلاد', labelFr: 'Date de naissance', labelEn: 'Date of Birth' },
  { key: 'nationality', type: 'string', required: false, labelAr: 'الجنسية', labelFr: 'Nationalité', labelEn: 'Nationality' },
  { key: 'wilaya', type: 'string', required: false, labelAr: 'الولاية', labelFr: 'Wilaya', labelEn: 'Wilaya' },
  { key: 'gender', type: 'string', required: false, labelAr: 'الجنس', labelFr: 'Sexe', labelEn: 'Gender' },
  { key: 'departure_airport', type: 'string', required: false, labelAr: 'مطار المغادرة', labelFr: 'Aéroport de départ', labelEn: 'Departure Airport' },
  { key: 'package_id', type: 'string', required: false, labelAr: 'الباقة', labelFr: 'Forfait', labelEn: 'Package' },
  { key: 'group_id', type: 'string', required: false, labelAr: 'الفوج', labelFr: 'Groupe', labelEn: 'Group' },
  { key: 'emergency_contact', type: 'phone', required: false, labelAr: 'جهة الطوارئ', labelFr: "Contact d'urgence", labelEn: 'Emergency Contact' },
  { key: 'notes', type: 'string', required: false, labelAr: 'ملاحظات', labelFr: 'Notes', labelEn: 'Notes' },
];

export const PAYMENT_FIELDS: FieldDefinition[] = [
  { key: 'passport_number', type: 'passport', required: true, labelAr: 'رقم جواز السفر', labelFr: 'N° Passeport', labelEn: 'Passport / Pilgrim ID' },
  { key: 'amount', type: 'currency', required: true, labelAr: 'المبلغ', labelFr: 'Montant', labelEn: 'Amount' },
  { key: 'payment_method', type: 'string', required: false, labelAr: 'طريقة الدفع', labelFr: 'Mode de paiement', labelEn: 'Payment Method' },
  { key: 'payment_date', type: 'date', required: false, labelAr: 'تاريخ الدفع', labelFr: 'Date de paiement', labelEn: 'Payment Date' },
  { key: 'notes', type: 'string', required: false, labelAr: 'ملاحظات', labelFr: 'Notes', labelEn: 'Notes' },
];

export const FIELD_SCHEMAS: Record<string, FieldDefinition[]> = {
  pilgrims: PILGRIM_FIELDS,
  payments: PAYMENT_FIELDS,
};
