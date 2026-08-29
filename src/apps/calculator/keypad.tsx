/**
 * Calculator — the keypad, the display and the tape.
 *
 * Views only: every one of these is a function of its props, so the whole
 * calculator can be looked at without a kernel behind it. The keys are a data
 * table rather than sixteen pieces of JSX, which is the only reason the layout is
 * legible — and it is Windows' layout, key for key, because that is the muscle
 * memory the app exists to serve.
 *
 * Keys are `fx-btn`, the same control class the kit's `Button` wears, so hover,
 * press and disabled states come from the OS stylesheet instead of being invented
 * here. Only size and weight are overridden — a keypad key is bigger than a
 * dialog button and nothing else about it is different.
 */
import { Copy, History, Trash2 } from 'lucide-react';
import { Badge, EmptyState, IconButton, useApp } from '@/platform/sdk';
import { type CalcError, type CalcKey, plain } from './math';
import type { HistoryEntry, MemoryKey } from './state';

type PadKind = 'digit' | 'op' | 'util' | 'equals';

interface PadKey {
  readonly id: string;
  readonly label: string;
  readonly kind: PadKind;
  readonly press: CalcKey;
}

const digit = (value: string): PadKey => ({
  id: `d${value}`,
  label: value,
  kind: 'digit',
  press: { kind: 'digit', digit: value },
});

/** Windows' Standard keypad: six rows of four, in that order. */
const KEYS: readonly (readonly PadKey[])[] = [
  [
    { id: 'percent', label: '%', kind: 'util', press: { kind: 'unary', op: 'percent' } },
    { id: 'ce', label: 'CE', kind: 'util', press: { kind: 'clearEntry' } },
    { id: 'c', label: 'C', kind: 'util', press: { kind: 'clear' } },
    { id: 'back', label: '⌫', kind: 'util', press: { kind: 'back' } },
  ],
  [
    { id: 'recip', label: '1/x', kind: 'util', press: { kind: 'unary', op: 'reciprocal' } },
    { id: 'sqr', label: 'x²', kind: 'util', press: { kind: 'unary', op: 'square' } },
    { id: 'sqrt', label: '√x', kind: 'util', press: { kind: 'unary', op: 'sqrt' } },
    { id: 'div', label: '÷', kind: 'op', press: { kind: 'binary', op: 'div' } },
  ],
  [digit('7'), digit('8'), digit('9'), { id: 'mul', label: '×', kind: 'op', press: { kind: 'binary', op: 'mul' } }],
  [digit('4'), digit('5'), digit('6'), { id: 'sub', label: '−', kind: 'op', press: { kind: 'binary', op: 'sub' } }],
  [digit('1'), digit('2'), digit('3'), { id: 'add', label: '+', kind: 'op', press: { kind: 'binary', op: 'add' } }],
  [
    { id: 'neg', label: '±', kind: 'util', press: { kind: 'unary', op: 'negate' } },
    digit('0'),
    { id: 'dot', label: '.', kind: 'util', press: { kind: 'dot' } },
    { id: 'eq', label: '=', kind: 'equals', press: { kind: 'equals' } },
  ],
];

const MEMORY_KEYS: readonly (readonly [MemoryKey, string])[] = [
  ['clear', 'MC'],
  ['recall', 'MR'],
  ['add', 'M+'],
  ['subtract', 'M−'],
  ['store', 'MS'],
];

export interface DisplayProps {
  readonly text: string;
  readonly trail: string;
  readonly error: CalcError | null;
  readonly memory: number | null;
  readonly onCopy: () => void;
}

/**
 * The display.
 *
 * Two lines, as every calculator has: what you are building above, and the number
 * itself below in the display type size. A locked display shows why it is locked
 * in words — "Cannot divide by zero" is information; `Infinity` is a leak.
 */
export function CalcDisplay({ text, trail, error, memory, onCopy }: DisplayProps) {
  const { tr } = useApp().locale;
  const message = (): string => {
    if (error === 'divideByZero') return tr('لا يمكن القسمة على صفر', 'Division par zéro impossible', 'Cannot divide by zero');
    if (error === 'zeroDivZero') return tr('النتيجة غير معرّفة', 'Résultat indéterminé', 'Result is undefined');
    if (error === 'overflow') return tr('تجاوز السعة', 'Dépassement de capacité', 'Overflow');
    return tr('إدخال غير صالح', 'Entrée non valide', 'Invalid input');
  };
  return (
    <div style={{ display: 'grid', gap: 2, padding: '10px 14px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 22 }}>
        {memory === null ? null : (
          <Badge tone="info" title={tr('الذاكرة', 'Mémoire', 'Memory')}>
            M
          </Badge>
        )}
        <div
          className="fx-num"
          style={{ flex: 1, minWidth: 0, fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)', overflow: 'hidden', whiteSpace: 'nowrap' }}
          title={trail}
        >
          {trail}
        </div>
        <IconButton icon={Copy} label={tr('نسخ', 'Copier', 'Copy')} onClick={onCopy} size={14} />
      </div>
      <div
        className="fx-num"
        role="status"
        aria-live="polite"
        style={{
          fontFamily: 'var(--fx-font-display)',
          fontSize: error === null ? 'var(--fx-display)' : 'var(--fx-body-large)',
          fontWeight: 600,
          lineHeight: 1.15,
          color: error === null ? 'var(--fx-text-primary)' : 'var(--fx-danger)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          direction: 'ltr',
        }}
        title={error === null ? text : message()}
      >
        {error === null ? text : message()}
      </div>
    </div>
  );
}

export interface KeypadProps {
  readonly onPress: (key: CalcKey) => void;
  readonly onMemory: (key: MemoryKey) => void;
  readonly hasMemory: boolean;
}

const VARIANT: Readonly<Record<PadKind, 'default' | 'accent' | 'subtle'>> = {
  digit: 'subtle',
  op: 'default',
  util: 'default',
  equals: 'accent',
};

/**
 * The keys. `type="button"` on every one of them: a keypad inside a form that
 * submitted on `=` would be a very short-lived joke.
 */
export function Keypad({ onPress, onMemory, hasMemory }: KeypadProps) {
  const { tr } = useApp().locale;
  const hint = (id: string): string | undefined => {
    if (id === 'ce') return tr('مسح الإدخال', 'Effacer l’entrée', 'Clear entry');
    if (id === 'c') return tr('مسح الكل', 'Tout effacer', 'Clear all');
    if (id === 'back') return tr('حذف رقم', 'Retour arrière', 'Backspace');
    if (id === 'recip') return tr('المقلوب', 'Inverse', 'Reciprocal');
    if (id === 'sqr') return tr('مربع', 'Carré', 'Square');
    if (id === 'sqrt') return tr('جذر تربيعي', 'Racine carrée', 'Square root');
    if (id === 'neg') return tr('تغيير الإشارة', 'Changer de signe', 'Change sign');
    if (id === 'percent') return tr('نسبة مئوية', 'Pourcentage', 'Percent');
    return undefined;
  };
  return (
    <div style={{ display: 'grid', gap: 8, padding: '0 12px 12px', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
        {MEMORY_KEYS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="fx-btn"
            data-variant="subtle"
            disabled={!hasMemory && (key === 'clear' || key === 'recall')}
            onClick={() => onMemory(key)}
            style={{ minHeight: 28, fontSize: 'var(--fx-caption)', fontWeight: 600 }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gridAutoRows: '1fr',
          gap: 6,
          flex: 1,
          minHeight: 0,
        }}
      >
        {KEYS.flat().map((key) => (
          <button
            key={key.id}
            type="button"
            className="fx-btn"
            data-variant={VARIANT[key.kind]}
            onClick={() => onPress(key.press)}
            title={hint(key.id)}
            aria-label={hint(key.id) ?? key.label}
            style={{
              minHeight: 42,
              height: '100%',
              fontSize: key.kind === 'digit' ? 19 : 16,
              fontWeight: key.kind === 'digit' ? 400 : 600,
            }}
          >
            {key.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface TapeProps {
  readonly history: readonly HistoryEntry[];
  readonly onRecall: (value: number) => void;
  readonly onClear: () => void;
}

/**
 * The tape.
 *
 * Newest at the top, and every line is a button: clicking one puts its result
 * back on the display, which is the whole reason a paper tape was worth keeping.
 * The expression is shown above the result rather than the result alone, because
 * a column of numbers with no arithmetic beside them is not a record of anything.
 */
export function HistoryTape({ history, onRecall, onClear }: TapeProps) {
  const { tr } = useApp().locale;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 8px 8px 12px',
          borderBottom: '1px solid var(--fx-divider)',
          flex: 'none',
        }}
      >
        <div style={{ flex: 1, fontSize: 'var(--fx-caption)', fontWeight: 600, color: 'var(--fx-text-secondary)' }}>
          {tr('السجل', 'Historique', 'History')}
        </div>
        <IconButton
          icon={Trash2}
          label={tr('مسح السجل', 'Effacer l’historique', 'Clear history')}
          onClick={onClear}
          disabled={history.length === 0}
          size={14}
        />
      </div>
      {history.length === 0 ? (
        <EmptyState
          compact
          icon={History}
          title={tr('لا سجل بعد', 'Aucun historique', 'No history yet')}
          description={tr(
            'كل عملية تُنهيها بعلامة يساوي تظهر هنا.',
            'Chaque calcul terminé par égal apparaît ici.',
            'Every calculation you finish with equals appears here.',
          )}
        />
      ) : (
        <div className="fx-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 6 }}>
          {history.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onRecall(entry.value)}
              title={tr('استرجاع النتيجة', 'Rappeler le résultat', 'Recall this result')}
              style={{
                display: 'grid',
                gap: 1,
                width: '100%',
                padding: '6px 8px',
                borderRadius: 'var(--fx-radius-control)',
                textAlign: 'end',
              }}
            >
              <span className="fx-num" style={{ display: 'block', fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}>
                {entry.expression}
              </span>
              <span className="fx-num" style={{ display: 'block', fontSize: 'var(--fx-body-large)', color: 'var(--fx-text-primary)' }}>
                {plain(entry.value)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
