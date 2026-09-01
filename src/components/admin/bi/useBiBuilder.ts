/**
 * The two things the analysis builder needs that are neither state nor markup: running
 * a request, and naming what is wrong with one.
 *
 * Both live in a `.ts` because a module that exports a component may not also export
 * plain functions, and because the run hook is the one read in this workspace that
 * deliberately does not run on its own.
 *
 * `useBiRead` reruns whenever its arguments change, which is right for a catalog and
 * wrong for a query: `run_bi_query_command` writes a `bi_query_log` row on every call,
 * including the ones it refuses, so a builder that ran as you typed would spend an
 * audit row per keystroke. This hook runs when it is told to, and reports the signature
 * of the request that produced the result it holds -- so the screen can say when the
 * chart in front of the reader was measured under an earlier request.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { biAnalytics, safeBiRead } from '@/services/biAnalytics';
import type { BiQueryRequest, BiQuerySuccess } from '@/types/bi';
import { requestSignature, type BuilderIssue } from './biBuilderState';
import { fmtInt, useBiChartLabels, useBiI18n } from './biFormat';

export interface BiRunState {
  result: BiQuerySuccess | null;
  /** The signature of the request that produced `result`, for comparison against the
   *  request the builder currently holds. */
  signature: string;
  running: boolean;
  error: string | null;
  run: () => void;
  /** How many runs have been asked for. Zero is a different state from "ran and got no
   *  rows", and the screen says so. */
  runs: number;
}

export function useBiRunQuery(request: BiQueryRequest | null): BiRunState {
  const [held, setHeld] = useState<{ result: BiQuerySuccess; signature: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Latest-ref: `run` is called in the same batch as the dispatch that changed the
  // request -- a drill regroups and re-runs together -- so the effect has to read the
  // request as of the render it fires after, not the one `run` was created in.
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    if (nonce === 0) return undefined;
    const current = requestRef.current;
    if (current === null) return undefined;
    let alive = true;
    setRunning(true);
    void safeBiRead(() => biAnalytics.runQuery(current)).then((res) => {
      if (!alive) return;
      setRunning(false);
      setError(res.error);
      // A failed run clears the result rather than keeping the last one beside an error.
      // Old numbers under a fresh error read as the answer to the request now on screen,
      // which is the one thing this layer exists to prevent.
      setHeld(res.data === null
        ? null
        : { result: res.data, signature: requestSignature(current) });
    });
    return () => { alive = false; };
  }, [nonce]);

  return {
    result: held?.result ?? null,
    signature: held?.signature ?? '',
    running,
    error,
    run: useCallback(() => setNonce((n) => n + 1), []),
    runs: nonce,
  };
}

/**
 * Each readiness issue as one sentence.
 *
 * Every sentence says what to do, not what is wrong: "add a dimension" rather than
 * "invalid request". Five of the eight mirror a raise in `bi_compile_query`, and those
 * are worded as the compiler's own refusal so a reader who does hit it later recognizes
 * the same fact rather than reading two accounts of it.
 */
export function useBuilderIssueText(): (issue: BuilderIssue) => string {
  const { t } = useBiI18n();
  const chartNames = useBiChartLabels();

  return useCallback((issue: BuilderIssue): string => {
    switch (issue.kind) {
      case 'NO_DATASET':
        return t('اختر مجموعة بيانات أولًا', 'Choisissez d’abord un jeu de données',
          'Choose a dataset first');
      case 'EMPTY':
        return t('التحليل يحتاج بعدًا واحدًا أو مقياسًا واحدًا على الأقل',
          'Une analyse a besoin d’au moins une dimension ou une mesure',
          'An analysis needs at least one dimension or metric');
      case 'NEEDS_DIMENSION':
        return t(`هذا الرسم يحتاج ${fmtInt(issue.need)} بعدًا وفيه ${fmtInt(issue.have)}`,
          `Ce graphique demande ${fmtInt(issue.need)} dimension(s), il en a ${fmtInt(issue.have)}`,
          `This chart needs ${fmtInt(issue.need)} grouping column(s) and has ${fmtInt(issue.have)}`);
      case 'NEEDS_MEASURE':
        return t(`هذا الرسم يحتاج ${fmtInt(issue.need)} مقياسًا وفيه ${fmtInt(issue.have)}`,
          `Ce graphique demande ${fmtInt(issue.need)} mesure(s), il en a ${fmtInt(issue.have)}`,
          `This chart needs ${fmtInt(issue.need)} measure(s) and has ${fmtInt(issue.have)}`);
      case 'NOT_DRAWN':
        return t(`${chartNames[issue.chartType]} لا يُرسم في هذه النسخة — يُحفظ ويُشغّل`,
          `${chartNames[issue.chartType]} n’est pas tracé dans cette version — il s’enregistre et s’exécute`,
          `${chartNames[issue.chartType]} has no renderer in this build — it still saves and runs`);
      case 'FILTER_INCOMPLETE':
        return t(`المرشّح ${fmtInt(issue.index + 1)} على ${issue.field} ينقصه قيمة`,
          `Le filtre ${fmtInt(issue.index + 1)} sur ${issue.field} n’a pas toutes ses valeurs`,
          `Filter ${fmtInt(issue.index + 1)} on ${issue.field} is missing a value`);
      case 'DEPRECATED_METRIC':
        return t(`المقياس ${issue.key} مُهمل، والمُصرّف يرفضه`,
          `La mesure ${issue.key} est dépréciée ; le compilateur la refuse`,
          `The metric ${issue.key} is deprecated and the compiler refuses it`);
      default:
        return t(`الترتيب على ${issue.key} ليس أحد الأعمدة المختارة`,
          `Le tri sur ${issue.key} n’est pas une des colonnes sélectionnées`,
          `Ordering by ${issue.key} is not one of the selected columns`);
    }
  }, [t, chartNames]);
}
