/**
 * Export, once, for all fourteen apps that offer it.
 *
 * Every finance app used to carry its own `exportCsv` — fourteen callbacks with
 * the same four steps and the same three toasts, differing only in which app's
 * `busy` they set. They are all this. The app supplies a `TableDocument` and the
 * format the person picked; the sequence, the dialog, the filing, the delivery
 * and the wording of the outcome are decided here.
 *
 * The sequence is deliberately *both* halves. The chosen file is written into
 * the OS filesystem, because the file manager, Notepad and the recent-files list
 * are real features of this desktop and an export that skipped them would vanish
 * from the machine it was made on. It is *also* handed to the browser, because
 * for years that second half was missing and an export produced nothing but a
 * toast and a path inside a simulation.
 *
 * This lives under `src/apps/shared/` rather than in the SDK on purpose: it
 * imports the export writers, and the platform is not allowed to depend on an
 * app's code. The boundary gate lets one app's file import another's, so every
 * app can reach it from here; the reverse would invert the whole architecture.
 */
import { useCallback, useState } from 'react';
import { useApp } from '@/platform/sdk';
import {
  contentTypeOf,
  fileNameFor,
  pdfNeedsBrowser,
  printableTable,
  writeTable,
  type ExportFormat,
  type TableDocument,
} from './export';
import { basename, REPORTS } from './paths';

/** Which format is in flight, so exactly one menu entry spins. */
export type ExportBusy = ExportFormat | null;

export interface TableExporter {
  readonly busy: ExportBusy;
  /**
   * Save `doc` as `format`. `baseName` is the suggested file name with or
   * without an extension — the extension always comes from the format.
   *
   * Fire-and-forget by design: the call site is a click handler, and every
   * outcome including cancellation is reported by this hook.
   */
  exportTable: (doc: TableDocument, baseName: string, format: ExportFormat) => void;
}

export function useExport(): TableExporter {
  const runtime = useApp();
  const { tr, rtl } = runtime.locale;
  const [busy, setBusy] = useState<ExportBusy>(null);

  const exportTable = useCallback(
    (doc: TableDocument, baseName: string, format: ExportFormat) => {
      // Reading order is a property of the session, not of the report: the same
      // treasury table is RTL in Arabic and LTR in French. The document may
      // still override it, which is how a deliberately Arabic report stays
      // Arabic when the shell is in English.
      const laid: TableDocument = doc.rtl === undefined ? { ...doc, rtl } : doc;

      const failed = (body: string) =>
        runtime.toast({
          kind: 'error',
          title: tr('تعذّر التصدير.', 'Export impossible.', 'Could not export.'),
          body,
        });

      const run = async () => {
        setBusy(format);
        try {
          if (format === 'pdf' && pdfNeedsBrowser(laid)) {
            await printThrough(laid);
            return;
          }
          await saveAndDeliver(laid, baseName, format);
        } catch (error) {
          // A writer throwing is a defect, not a user outcome — but the person
          // is still owed a sentence rather than a control that span and stopped.
          await failed(error instanceof Error ? error.message : String(error));
        } finally {
          setBusy(null);
        }
      };

      /** The ordinary path: bytes, a place to put them, the file itself. */
      const saveAndDeliver = async (document: TableDocument, base: string, chosenFormat: ExportFormat) => {
        const built = await writeTable(document, chosenFormat, new Date());
        const chosen = await runtime.invoke('shell.fileDialog', {
          mode: 'save',
          title: tr('تصدير', 'Exporter', 'Export'),
          startPath: REPORTS,
          suggestedName: fileNameFor(base, chosenFormat),
          contentTypes: [contentTypeOf(chosenFormat)],
        });
        // A cancelled dialog is an answer, not a failure: nothing is said about it.
        const path = chosen.ok ? chosen.value.path : null;
        if (path === null) return;

        const filed = await runtime.invoke('fs.writeBinary', {
          path,
          bytes: built.bytes,
          contentType: built.contentType,
        });
        if (!filed.ok) {
          await failed(filed.error.message);
          return;
        }
        const handed = await runtime.invoke('shell.download', {
          fileName: basename(path),
          bytes: built.bytes,
          contentType: built.contentType,
        });
        await runtime.toast(
          handed.ok
            ? { kind: 'success', title: tr('تم التصدير.', 'Export terminé.', 'Exported.'), body: path }
            : {
                // The file exists inside the OS either way; only the hand-off to
                // the browser failed, and saying "exported" would be a lie the
                // person discovers in their downloads folder.
                kind: 'warning',
                title: tr('حُفظ داخل النظام فقط.', 'Enregistré dans le système seulement.', 'Saved inside the OS only.'),
                body: path,
              },
        );
      };

      /**
       * The Arabic path. The built-in PDF writer sets Helvetica, which has no
       * Arabic glyphs and no way to join them; the browser under this tab has
       * the text stack that does, and its print dialog offers "Save as PDF". So
       * the same table goes out as a print-styled page instead of as bytes.
       */
      const printThrough = async (document: TableDocument) => {
        const html = await printableTable(document);
        const printed = await runtime.invoke('shell.print', { title: document.title, html });
        if (!printed.ok) {
          await failed(printed.error.message);
          return;
        }
        await runtime.toast({
          kind: 'info',
          title: tr('جاهز للطباعة.', 'Prêt pour l’impression.', 'Ready to print.'),
          body: tr(
            'اختر «حفظ بصيغة PDF» لأن الخط العربي يُرسم بواسطة المتصفّح.',
            'Choisissez « Enregistrer au format PDF » : la typographie arabe est rendue par le navigateur.',
            'Choose “Save as PDF” — Arabic type is shaped by the browser.',
          ),
        });
      };

      void run();
    },
    [runtime, rtl, tr],
  );

  return { busy, exportTable };
}
