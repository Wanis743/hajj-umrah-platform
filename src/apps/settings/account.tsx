/**
 * Settings — language and account.
 *
 * Language is one registry value. Nothing in this file translates anything: the
 * shell re-reads `Appearance\Language` and hands every process a new `AppLocale`,
 * so the preview card below re-renders in the new language on the way back from
 * the write. That round trip is the point — an app that translated itself would
 * be lying about where the setting lives.
 *
 * The account page is the visible half of the security subsystem. Elevation is a
 * time-limited token held by the *principal*, not by this app, which is why the
 * rows here read their state from `security.check` rather than remembering
 * whether a consent prompt was accepted.
 */
import { useState } from 'react';
import { Building2, Globe, KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  type Capability,
  EmptyState,
  InfoBar,
  type Localized,
  PropertyRow,
  Section,
  Select,
  capabilityLabel,
  fmt,
  useApp,
  useCapability,
  usePolledSyscall,
} from '@/platform/sdk';
import { Hero, Row } from './parts';
import { KEYS, LANG_CHOICES, oneOf, useRegistryValue, type LangCode } from './prefs';

const PRINCIPAL_MS = 10_000;

/** A sample of every format the locale changes, for the preview card. */
const SAMPLE_AMOUNT = 1234567.89;

/**
 * The two privileged capabilities this app holds. Kept as a literal because the
 * kernel's privileged set is not part of the ABI — `security.check` answers
 * whether elevation is required, which is the question that actually matters.
 */
const ELEVATABLE: readonly { readonly capability: Capability; readonly why: Localized }[] = [
  {
    capability: 'registry.write',
    why: {
      ar: 'تعديل سياسة الجهاز في HKLM',
      fr: 'Modifier la stratégie machine dans HKLM',
      en: 'Change machine policy under HKLM',
    },
  },
  {
    capability: 'power',
    why: {
      ar: 'إيقاف النظام أو تسجيل الخروج',
      fr: 'Arrêter le système ou se déconnecter',
      en: 'Shut down or sign out',
    },
  },
];

export function LanguagePage() {
  const { t, tr, lang, rtl } = useApp().locale;
  const [language, setLanguage] = useRegistryValue<string>(KEYS.appearance, 'Language', 'en');
  const current = oneOf<LangCode>(language, LANG_CHOICES, 'en');

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Section title={tr('لغة العرض', 'Langue d’affichage', 'Display language')}>
        <Card icon={Globe} padded>
          <Row
            title={tr('اللغة', 'Langue', 'Language')}
            hint={tr(
              'تُطبَّق على النظام وكل التطبيقات فورًا',
              'Appliquée au système et à toutes les applications',
              'Applies to the shell and every app at once',
            )}
          >
            <Select
              value={current}
              onChange={setLanguage}
              width={220}
              options={LANG_CHOICES.map((choice) => ({ value: choice.value, label: t(choice.label) }))}
            />
          </Row>
          <Row title={tr('اتجاه الكتابة', 'Sens d’écriture', 'Text direction')}>
            <Badge tone="neutral">{rtl ? 'RTL' : 'LTR'}</Badge>
          </Row>
        </Card>
      </Section>

      <Section title={tr('التنسيق الإقليمي', 'Format régional', 'Regional format')}>
        <Card padded>
          <PropertyRow label={tr('العملة', 'Devise', 'Currency')} mono>
            {fmt.money(SAMPLE_AMOUNT, 'DZD', lang)}
          </PropertyRow>
          <PropertyRow label={tr('الأرقام', 'Nombres', 'Numbers')} mono>
            {fmt.amount(SAMPLE_AMOUNT, lang)}
          </PropertyRow>
          <PropertyRow label={tr('مختصر', 'Abrégé', 'Compact')} mono>
            {fmt.compact(SAMPLE_AMOUNT, lang)}
          </PropertyRow>
          <PropertyRow label={tr('النسبة', 'Pourcentage', 'Percentage')} mono>
            {fmt.percent(0.1875, lang)}
          </PropertyRow>
          <PropertyRow label={tr('التاريخ والوقت', 'Date et heure', 'Date and time')} mono>
            {fmt.dateTime(Date.now(), lang)}
          </PropertyRow>
        </Card>
      </Section>
    </div>
  );
}

/**
 * One capability, one consent button.
 *
 * This is a component rather than a loop body because `security.check` is a hook,
 * and each row needs its own subscription — the elevation token expires on the
 * kernel's clock, so the row has to hear about it without a re-render from above.
 */
function ElevationRow({ capability, why }: { capability: Capability; why: Localized }) {
  const runtime = useApp();
  const { t, tr } = runtime.locale;
  const { granted, elevationRequired } = useCapability(capability);
  const [busy, setBusy] = useState(false);

  const elevate = async () => {
    setBusy(true);
    const result = await runtime.invoke('security.elevate', { reason: why, capability });
    setBusy(false);
    if (!result.ok) {
      void runtime.toast({ kind: 'error', title: result.error.message });
      return;
    }
    void runtime.toast({
      kind: result.value.granted ? 'success' : 'warning',
      title: result.value.granted
        ? tr('تم رفع الصلاحية', 'Privilège accordé', 'Elevated')
        : tr('تم رفض الطلب', 'Demande refusée', 'Consent declined'),
    });
  };

  return (
    <Row title={t(capabilityLabel(capability))} hint={t(why)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {!granted ? (
          <Badge tone="danger">{tr('غير ممنوح', 'Non accordé', 'Not granted')}</Badge>
        ) : elevationRequired ? (
          <Badge tone="warning">{tr('يتطلب موافقة', 'Consentement requis', 'Consent required')}</Badge>
        ) : (
          <Badge tone="success">{tr('نشط', 'Actif', 'Active')}</Badge>
        )}
        <Button
          size="sm"
          icon={KeyRound}
          disabled={!granted || !elevationRequired}
          busy={busy}
          onClick={() => void elevate()}
        >
          {tr('ارفع', 'Élever', 'Elevate')}
        </Button>
      </div>
    </Row>
  );
}

export function AccountPage() {
  const { t, tr, lang } = useApp().locale;
  const principal = usePolledSyscall('security.principal', {}, PRINCIPAL_MS).data;

  if (principal === null) {
    return <EmptyState icon={UserRound} title={tr('جارٍ قراءة الحساب…', 'Lecture du compte…', 'Reading account…')} />;
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Hero
        icon={UserRound}
        title={principal.displayName}
        subtitle={principal.email ?? String(principal.sid)}
        actions={
          principal.elevated ? (
            <Badge tone="success" icon={ShieldCheck}>
              {tr('مرفوع الصلاحية', 'Élevé', 'Elevated')}
            </Badge>
          ) : undefined
        }
      />

      <Section title={tr('الحساب', 'Compte', 'Account')}>
        <Card padded>
          <PropertyRow label={tr('المعرّف الأمني', 'Identifiant de sécurité', 'Security id')} mono>
            {String(principal.sid)}
          </PropertyRow>
          <PropertyRow label={tr('البريد', 'Courriel', 'Email')}>{principal.email ?? '—'}</PropertyRow>
          <PropertyRow label={tr('الوكالة', 'Agence', 'Agency')} mono>
            {principal.agencyId ?? '—'}
          </PropertyRow>
          <PropertyRow label={tr('الفرع', 'Succursale', 'Branch')} mono>
            {principal.branchId ?? '—'}
          </PropertyRow>
          <div style={{ paddingTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {principal.roles.length === 0 ? (
              <Badge tone="neutral">{tr('بلا أدوار', 'Aucun rôle', 'No roles')}</Badge>
            ) : (
              principal.roles.map((role) => (
                <Badge key={role} tone="accent" icon={Building2}>
                  {role}
                </Badge>
              ))
            )}
          </div>
        </Card>
      </Section>

      <Section title={tr('رفع الصلاحيات', 'Élévation', 'Elevation')}>
        <Card icon={ShieldCheck} padded>
          {principal.elevated && principal.elevationExpiresAt !== null ? (
            <div style={{ paddingBottom: 10 }}>
              <InfoBar tone="success" title={tr('الصلاحية سارية', 'Privilège actif', 'Privilege held')}>
                {tr(
                  `تنتهي ${fmt.relativeTime(principal.elevationExpiresAt, lang)} (${fmt.time(principal.elevationExpiresAt, lang)})`,
                  `Expire ${fmt.relativeTime(principal.elevationExpiresAt, lang)} (${fmt.time(principal.elevationExpiresAt, lang)})`,
                  `Expires ${fmt.relativeTime(principal.elevationExpiresAt, lang)} (${fmt.time(principal.elevationExpiresAt, lang)})`,
                )}
              </InfoBar>
            </div>
          ) : null}
          {ELEVATABLE.map((entry) => (
            <ElevationRow key={entry.capability} capability={entry.capability} why={entry.why} />
          ))}
        </Card>
      </Section>

      <Section title={tr('صلاحيات الجلسة', 'Autorisations de la session', 'Session permissions')}>
        <Card padded>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {principal.capabilities.map((capability) => (
              <Badge key={capability} tone="neutral" title={capability}>
                {t(capabilityLabel(capability))}
              </Badge>
            ))}
          </div>
        </Card>
      </Section>
    </div>
  );
}
