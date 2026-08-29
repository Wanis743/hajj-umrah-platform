/**
 * Calculator — the window.
 *
 * Three calculators behind one Pivot, and the choice is remembered per user, so
 * someone who lives in the cash-flow panel does not land on a keypad every morning.
 * Composition only: `state.ts` owns the keypad, `analysis.ts` the two finance forms,
 * `math.ts` and `finance.ts` the arithmetic, and this file decides what is on screen
 * and what the accelerators mean in each mode.
 *
 * The keyboard is bound on a wrapper that takes focus while the standard keypad is
 * showing, because a calculator that cannot be typed into is a mouse toy. It is
 * bound *only* in that mode: the finance panels are full of number fields, and a
 * digit typed into one of those belongs to the field, not to the keypad.
 */
import { useEffect, useRef } from 'react';
import { History } from 'lucide-react';
import {
  AppFrame,
  Button,
  Segmented,
  StatusItem,
  ToolbarSpacer,
  fmt,
  useApp,
  useAppCommands,
  useSetting,
  useWindowTitle,
} from '@/platform/sdk';
import type { SegmentedOption } from '@/platform/sdk';
import { useCashflow, useTvm } from './analysis';
import type { Timing } from './finance';
import { CalcDisplay, HistoryTape, Keypad } from './keypad';
import { plain } from './math';
import { CashflowPanel, TvmPanel } from './panels';
import { type Mode, useCopy, useMode, useStandard } from './state';

export default function CalculatorApp() {
  const { tr, lang } = useApp().locale;
  const [mode, setMode] = useMode();
  const [tapeOpen, setTapeOpen] = useSetting<boolean>('tape', true);
  const standard = useStandard();
  const tvm = useTvm();
  const cashflow = useCashflow();
  const copy = useCopy();
  const surface = useRef<HTMLDivElement>(null);

  const heading = (): string => {
    if (mode === 'tvm') return tr('القيمة الزمنية للنقود', 'Valeur temps de l’argent', 'Time value of money');
    if (mode === 'cashflow') return tr('التدفقات النقدية', 'Flux de trésorerie', 'Cash flow');
    return tr('قياسي', 'Standard', 'Standard');
  };
  useWindowTitle(`${heading()} — ${tr('الآلة الحاسبة', 'Calculatrice', 'Calculator')}`);

  // Focus follows the mode: the keypad wants the keyboard, the forms want it left alone.
  useEffect(() => {
    if (mode === 'standard') surface.current?.focus();
  }, [mode]);

  /** What `Ctrl+C` means here — a plain, ungrouped number, ready to be pasted. */
  const answer = (): string => {
    if (mode === 'tvm') return tvm.result.ok ? plain(tvm.result.value) : '';
    if (mode === 'cashflow') return plain(cashflow.metrics.npv);
    return plain(standard.value);
  };

  useAppCommands((commandId) => {
    if (commandId === 'standard' || commandId === 'tvm' || commandId === 'cashflow') {
      setMode(commandId);
      return;
    }
    if (commandId === 'copy') {
      const text = answer();
      if (text !== '') copy(text);
      return;
    }
    if (commandId !== 'clear') return;
    if (mode === 'tvm') tvm.reset();
    else if (mode === 'cashflow') cashflow.reset();
    else standard.push({ kind: 'clear' });
  });

  /**
   * The mode switch is a Segmented control rather than a Pivot: it sits in the
   * command bar, and a pivot's underline wants to be flush with a divider of its
   * own rather than floating inside a 44-pixel strip.
   */
  const modes: readonly SegmentedOption<Mode>[] = [
    { value: 'standard', label: tr('قياسي', 'Standard', 'Standard') },
    { value: 'tvm', label: tr('القيمة الزمنية', 'Valeur temps', 'Time value') },
    { value: 'cashflow', label: tr('التدفقات', 'Flux', 'Cash flow') },
  ];

  const commands = (
    <>
      <Segmented value={mode} onChange={setMode} options={modes} />
      <ToolbarSpacer />
      {mode === 'standard' ? (
        <Button
          size="sm"
          variant={tapeOpen ? 'accent' : 'subtle'}
          icon={History}
          onClick={() => setTapeOpen(!tapeOpen)}
        >
          {tr('السجل', 'Historique', 'History')}
        </Button>
      ) : null}
    </>
  );

  const keypad = (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
      <CalcDisplay
        text={standard.text}
        trail={standard.trail}
        error={standard.error}
        memory={standard.memory}
        onCopy={() => copy(plain(standard.value))}
      />
      <Keypad onPress={standard.push} onMemory={standard.memoryKey} hasMemory={standard.memory !== null} />
    </div>
  );

  return (
    <AppFrame
      commands={commands}
      status={
        <CalcStatus
          mode={mode}
          memory={standard.memory}
          target={tvm.target}
          timing={tvm.timing}
          periods={cashflow.rows.length}
          npv={cashflow.metrics.npv}
          npvText={fmt.compact(cashflow.metrics.npv, lang)}
        />
      }
      scroll={false}
    >
      <div
        ref={surface}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (mode !== 'standard') return;
          if (standard.onKeyDown(event)) event.preventDefault();
        }}
        style={{ display: 'flex', flex: 1, minHeight: 0, outline: 'none' }}
      >
        {mode === 'tvm' ? <TvmPanel model={tvm} onCopy={copy} /> : null}
        {mode === 'cashflow' ? <CashflowPanel model={cashflow} onCopy={copy} /> : null}
        {mode === 'standard' ? keypad : null}
        {mode === 'standard' && tapeOpen ? (
          <div
            style={{
              width: 268,
              flex: 'none',
              display: 'flex',
              borderInlineStart: '1px solid var(--fx-divider)',
            }}
          >
            <HistoryTape history={standard.history} onRecall={standard.recall} onClear={standard.clearHistory} />
          </div>
        ) : null}
      </div>
    </AppFrame>
  );
}

interface StatusProps {
  readonly mode: Mode;
  readonly memory: number | null;
  readonly target: string;
  readonly timing: Timing;
  readonly periods: number;
  readonly npv: number;
  readonly npvText: string;
}

/**
 * The status bar.
 *
 * Each mode reports the one piece of state that changes what its numbers mean —
 * the memory register, which key is being solved for and when payments land, or how
 * many periods the appraisal covers. Given plain values rather than the three models
 * so the bar cannot quietly become a second place where behaviour lives.
 */
function CalcStatus({ mode, memory, target, timing, periods, npv, npvText }: StatusProps) {
  const { tr } = useApp().locale;
  if (mode === 'tvm') {
    return (
      <>
        <StatusItem>{`${tr('احسب', 'Calculer', 'Solve for')}: ${target.toUpperCase()}`}</StatusItem>
        <ToolbarSpacer />
        <StatusItem>
          {timing === 'begin'
            ? tr('الدفعات أول الفترة', 'Paiements en début de période', 'Payments at period start')
            : tr('الدفعات آخر الفترة', 'Paiements en fin de période', 'Payments at period end')}
        </StatusItem>
      </>
    );
  }
  if (mode === 'cashflow') {
    return (
      <>
        <StatusItem>{`${periods} ${tr('فترة', 'périodes', 'periods')}`}</StatusItem>
        <ToolbarSpacer />
        <StatusItem tone={npv >= 0 ? 'success' : 'danger'}>{`NPV ${npvText}`}</StatusItem>
      </>
    );
  }
  return (
    <>
      <StatusItem title={tr('سجل الذاكرة', 'Registre mémoire', 'Memory register')}>
        {memory === null ? tr('الذاكرة فارغة', 'Mémoire vide', 'Memory empty') : `M = ${plain(memory)}`}
      </StatusItem>
      <ToolbarSpacer />
      <StatusItem>{tr('لوحة المفاتيح مفعّلة', 'Clavier actif', 'Keyboard active')}</StatusItem>
    </>
  );
}
