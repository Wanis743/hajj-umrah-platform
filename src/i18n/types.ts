export type Lang = 'ar' | 'fr' | 'en' | 'dz';

export const languages: { code: Lang; label: string; flag: string; dir: 'rtl' | 'ltr' }[] = [
  { code: 'ar', label: 'العربية', flag: '🇩🇿', dir: 'rtl' },
  { code: 'dz', label: 'الدارجة', flag: '🇩🇿', dir: 'rtl' },
  { code: 'fr', label: 'Français', flag: '🇫🇷', dir: 'ltr' },
  { code: 'en', label: 'English', flag: '🇬🇧', dir: 'ltr' },
];

export interface Translation {
  nav: {
    home: string;
    why: string;
    packages: string;
    testimonials: string;
    about: string;
    contact: string;
    reserve: string;
    bookNow: string;
  };
  hero: {
    badge: string;
    title: string;
    subtitle: string;
    cta: string;
    explore: string;
    features: string;
  };
  trust: {
    pilgrims: string;
    experience: string;
    rating: string;
    satisfaction: string;
  };
  why: {
    badge: string;
    title: string;
    subtitle: string;
    f1Title: string;
    f1Desc: string;
    f2Title: string;
    f2Desc: string;
    f3Title: string;
    f3Desc: string;
  };
  packages: {
    badge: string;
    title: string;
    subtitle: string;
    duration: string;
    details: string;
    bookThis: string;
    includes: string;
    customize: string;
    perPerson: string;
    empty: string;
    loading: string;
  };
  testimonials: {
    badge: string;
    title: string;
    subtitle: string;
  };
  about: {
    badge: string;
    title: string;
    p1: string;
    p2: string;
    yearsExp: string;
    pilgrims: string;
    experience: string;
    rating: string;
    satisfaction: string;
  };
  location: {
    badge: string;
    title: string;
    subtitle: string;
    address: string;
    getDirections: string;
  };
  contact: {
    badge: string;
    title: string;
    subtitle: string;
    phone: string;
    whatsapp: string;
    email: string;
    address: string;
    addressValue: string;
    hours: string;
    hoursValue: string;
  };
  footer: {
    about: string;
    quickLinks: string;
    contactUs: string;
    rights: string;
  };
  reserve: {
    title: string;
    subtitle: string;
    step1: string;
    step2: string;
    step3: string;
    step4: string;
    selectPackage: string;
    selectPackageDesc: string;
    next: string;
    back: string;
    dates: string;
    datesDesc: string;
    startDate: string;
    endDate: string;
    travelers: string;
    details: string;
    detailsDesc: string;
    fullName: string;
    notes: string;
    notesPlaceholder: string;
    review: string;
    reviewDesc: string;
    package: string;
    confirm: string;
    confirming: string;
    success: string;
    successMsg: string;
    reference: string;
    summary: string;
    status: string;
    statusPending: string;
    backToHome: string;
    newReservation: string;
    required: string;
    selectPackageFirst: string;
    fillAllFields: string;
    selectDate: string;
    day: string;
    month: string;
    year: string;
    time: string;
    datesError: string;
    invalidDatePast: string;
    invalidEndDate: string;
    invalidTravelers: string;
    invalidName: string;
    invalidPhone: string;
    invalidEmail: string;
    dateInfo: string;
    noLoginNeeded: string;
    spamError: string;
    stepOf: string;
    tripDuration: string;
    days: string;
    bookingSummary: string;
    copyReference: string;
    copied: string;
  };
  theme: {
    light: string;
    dark: string;
  };
  timeline: {
    badge: string;
    title: string;
    subtitle: string;
    steps: { title: string; desc: string }[];
  };
  countdown: {
    badge: string;
    title: string;
    subtitle: string;
    days: string;
    hours: string;
    minutes: string;
    seconds: string;
    noDate: string;
  };
  faq: {
    badge: string;
    title: string;
    subtitle: string;
    items: { q: string; a: string }[];
  };
  admin: {
    loginTitle: string;
    email: string;
    password: string;
    signIn: string;
    signingIn: string;
    error: string;
    backToSite: string;
    dashboard: string;
    logout: string;
    total: string;
    pending: string;
    confirmed: string;
    cancelled: string;
    reservations: string;
    search: string;
    all: string;
    reference: string;
    package: string;
    customer: string;
    dates: string;
    travelers: string;
    status: string;
    actions: string;
    confirm: string;
    cancel: string;
    delete: string;
    departureDate: string;
    save: string;
    saving: string;
    noReservations: string;
    phone: string;
    notes: string;
    saved: string;
    securePortal: string;
    loginBrand: string;
    loginSubtitle: string;
    loginFormHint: string;
    featureManage: string;
    featureTrack: string;
    featureSettings: string;
    settings: string;
    manageReservations: string;
    welcome: string;
    refresh: string;
    loading: string;
    noReservationsHint: string;
    deleteConfirm: string;
    deleteConfirmMsg: string;
    submittedAt: string;
    days: string;
    ago: string;
    hidePassword: string;
    showPassword: string;
    recentActivity: string;
  };
}

