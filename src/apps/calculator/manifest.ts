/**
 * Calculator — manifest.
 *
 * Three calculators in one window, which is what the finance desk actually needs:
 * the Windows arithmetic keypad, the five-key time-value-of-money solver every
 * business calculator since the HP-12C has had (N, I/Y, PV, PMT, FV — give four,
 * get the fifth), and a cash-flow sheet that answers NPV, IRR and payback.
 *
 * No `fs.*` capability: this app reads and writes no files. What it does persist
 * is the chosen mode and the rounding preference, under `HKCU` via `useSetting`,
 * which is why `registry.read`/`registry.write` are here and no elevation prompt
 * follows from them. `clipboard` is for copying a result out to wherever the
 * number was needed.
 */
import { APP_IDS } from '@/platform/kernel/abi';
import { defineApp, text } from '../shared/manifest';

export const calculatorManifest = defineApp({
  id: APP_IDS.calculator,
  name: text('الآلة الحاسبة', 'Calculatrice', 'Calculator'),
  description: text(
    'حسابات قياسية، وحل القيمة الزمنية للنقود، وصافي القيمة الحالية ومعدل العائد الداخلي',
    'Calculs standard, résolution de la valeur temps de l’argent, VAN et TRI',
    'Standard arithmetic, time-value-of-money solving, NPV and IRR',
  ),
  category: 'productivity',
  icon: 'calculator',
  capabilities: ['registry.read', 'registry.write', 'clipboard', 'notify'],
  defaultSize: { w: 940, h: 680 },
  minSize: { w: 420, h: 540 },
  keywords: [
    'calculator',
    'npv',
    'irr',
    'pmt',
    'tvm',
    'annuity',
    'payback',
    'calculatrice',
    'van',
    'tri',
    'annuité',
    'حاسبة',
    'القيمة الحالية',
    'معدل العائد',
    'قسط',
  ],
  jumpList: [
    { id: 'standard', title: text('قياسي', 'Standard', 'Standard') },
    { id: 'tvm', title: text('القيمة الزمنية للنقود', 'Valeur temps de l’argent', 'Time value of money') },
    { id: 'cashflow', title: text('التدفقات النقدية', 'Flux de trésorerie', 'Cash flow') },
  ],
  commands: [
    { id: 'standard', title: text('حاسبة قياسية', 'Calculatrice standard', 'Standard calculator') },
    { id: 'tvm', title: text('حل القيمة الزمنية للنقود', 'Résoudre la valeur temps de l’argent', 'Solve time value of money') },
    { id: 'cashflow', title: text('صافي القيمة الحالية ومعدل العائد', 'VAN et TRI', 'NPV and IRR') },
    { id: 'copy', title: text('نسخ النتيجة', 'Copier le résultat', 'Copy result'), accelerator: 'Ctrl+C' },
    { id: 'clear', title: text('مسح', 'Effacer', 'Clear'), accelerator: 'Esc' },
  ],
});
