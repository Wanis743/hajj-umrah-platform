/**
 * Why publishing is refused.
 *
 * One question, asked of a document rather than of a server: may this model be published, and if
 * not, what is the sentence a person should read? It lives in a file of its own for a reason that
 * is not cosmetic. `panels.tsx` renders the answer, `index.tsx` acts on it, and neither is where a
 * policy decision belongs; `document.ts` parses ledger rows into a document and has no business
 * knowing what publishing requires. A predicate that three modules consume is its own module.
 *
 * It is also the shape the lint rule wants. `react-refresh/only-export-components` fails a file
 * that exports both a component and a plain function, because Fast Refresh cannot tell which of
 * the two changed and has to discard the state of everything downstream. Moving the function out
 * is the fix; suppressing the rule would trade a real editing loop for a shorter diff.
 */
import type { Localized } from '@/platform/sdk';
import type { ModelVersion } from '../engine';
import type { ModelDocument } from './document';

/** Whether the verb is available, why not when it is not, and whether it will ask for consent. */
export interface PublishGate {
  readonly ready: boolean;
  readonly reason: Localized | null;
  readonly elevates: boolean;
}

/** The hash the server accepts: sixteen lower-case hex digits, and `publish_model` does not
 *  normalise, so upper-case hex is refused there rather than folded. */
const HASH16 = /^[0-9a-f]{16}$/;

/**
 * The server's four preconditions, restated in the browser so the button can explain itself.
 *
 * This is duplication, and deliberate. `publish_model` refuses with SQLSTATE `22023` when the
 * model is not a draft, has no rows, has fewer than two scenarios, or is handed a hash that is
 * not sixteen hex digits — and those refusals are the authority, not this function. What the
 * server cannot do is answer *before* the click. A person looking at a greyed-out Publish deserves
 * the sentence now, and the only way to give it to them is to know the same four rules here.
 *
 * The order is not arbitrary: it is the order in which somebody can act on the answer. "Reopen it
 * as a draft" is one click; "add a second scenario" is a dialog; "the model does not compile" is
 * the failure report already on screen. Reporting the cheapest fix first is the difference between
 * a gate that teaches and a gate that scolds.
 *
 * `elevates` is passed through rather than consulted: a verb that will ask for consent is still an
 * available verb, and refusing the click here would replace a consent prompt with a dead button.
 */
export function publishGate(
  document: ModelDocument | null,
  version: ModelVersion | null,
  elevates: boolean,
): PublishGate {
  const no = (reason: Localized): PublishGate => ({ ready: false, reason, elevates });
  if (document === null) {
    return no({ ar: 'لا نموذج مفتوح.', fr: 'Aucun modèle ouvert.', en: 'No model is open.' });
  }
  if (document.header.status !== 'DRAFT') {
    return no({
      ar: 'لا يُنشر إلا ما هو مسوّدة. أعِده إلى مسوّدة أولًا.',
      fr: 'Seul un brouillon se publie. Repassez-le en brouillon.',
      en: 'Only a draft can be published. Reopen it as a draft first.',
    });
  }
  if (document.rows.length === 0) {
    return no({
      ar: 'النموذج بلا أسطر: لا شيء يُنشر.',
      fr: 'Le modèle n’a aucune ligne : rien à publier.',
      en: 'The model has no rows, so there is nothing to publish.',
    });
  }
  if (document.scenarios.length < 2) {
    return no({
      ar: 'يحتاج النشر سيناريوهين على الأقل ليكون هناك ما يُقارَن به.',
      fr: 'La publication exige au moins deux scénarios, pour qu’il existe un point de comparaison.',
      en: 'Publishing needs at least two scenarios, so that there is something to compare against.',
    });
  }
  if (version === null || !HASH16.test(version.fullHash)) {
    return no({
      ar: 'النموذج لا يُترجم، فلا بصمة تُنشر.',
      fr: 'Le modèle ne compile pas : aucune empreinte à publier.',
      en: 'The model does not compile, so there is no hash to publish.',
    });
  }
  return { ready: true, reason: null, elevates };
}
