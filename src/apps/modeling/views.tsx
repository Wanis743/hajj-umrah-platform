/**
 * Modeling — what the four views are called.
 *
 * This file exists because the window has two toolbars. The projection's chrome and the
 * workbench's chrome share no other control — one counts overridden accounts, the other
 * counts unsaved rows — but both have to offer the same four-way switch, spelled the same
 * way, in the same order, in three languages. Two copies of that list is two chances for
 * `Ctrl+4` to be labelled one thing on the left of the window and another on the right.
 *
 * The switch emits command ids rather than views. Every other verb in this window arrives at
 * `shell.perform` as a string, and a view switcher that reached past it to `changeView` would
 * be the one control whose behaviour the command path could not describe.
 */
import { Activity, LineChart, Scale, Wrench } from 'lucide-react';
import { Segmented, type SegmentedOption, useLocale } from '@/platform/sdk';
import type { ModelingView } from './model';

/**
 * The four, in the order the manifest's accelerators number them.
 *
 * `Wrench` for the workbench is the manifest's own noun — ورشة, atelier, workbench — and the
 * three projection icons are the three questions they answer: the shape of the line, the
 * months it runs through, and the plan it is held against.
 *
 * Not exported: the sharing this file was written for happens through `ViewSwitch`, and both
 * toolbars take the component. A hook exported beside a component is also what
 * `react-refresh/only-export-components` refuses, and correctly — Fast Refresh cannot tell
 * which of the two a save touched.
 */
function useViewOptions(): readonly SegmentedOption<ModelingView>[] {
  const { tr } = useLocale();
  return [
    { value: 'forecast', label: tr('التوقّع', 'Prévision', 'Forecast'), icon: LineChart },
    { value: 'timeline', label: tr('الأشهر', 'Mois', 'Months'), icon: Activity },
    { value: 'compare', label: tr('مقابل الخطة', 'Face au plan', 'Against plan'), icon: Scale },
    { value: 'workbench', label: tr('الورشة', 'Atelier', 'Workbench'), icon: Wrench },
  ];
}

interface ViewSwitchProps {
  readonly view: ModelingView;
  /** Receives `view:forecast` and the rest, because that is what the manifest declares. */
  onCommand: (id: string) => void;
  readonly size?: 'sm' | 'md';
}

export function ViewSwitch({ view, onCommand, size }: ViewSwitchProps) {
  const options = useViewOptions();
  return <Segmented value={view} onChange={(next) => onCommand(`view:${next}`)} options={options} size={size} />;
}
