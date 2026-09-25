/**
 * Notepad — manifest.
 *
 * The associations are the important half. `handlerFor` is first-match-wins over
 * the installed manifests, so whatever Notepad claims here is what a double-click
 * on the desktop opens — and by claiming `text/plain`, `text/markdown`,
 * `text/csv` and `application/json` it becomes the default opener for everything
 * in the image that is text and is not a ledger document.
 *
 * `text/csv` came here when Sheets was removed. It is the one association in the
 * list Notepad did not choose: a CSV is a table, and a text editor shows it as
 * the commas it literally is. But every finance app in the suite exports CSV, so
 * the alternative was a file type the OS could produce and then refuse to open —
 * and Notepad displaying it plainly is a smaller lie than that.
 *
 * `singleInstance` is deliberate and not laziness: Notepad has tabs, so a second
 * launch should hand the running window another tab rather than open a second
 * Notepad. The kernel makes that possible by re-activating the live process with
 * the new args instead of spawning one.
 */
import { defineApp, text } from '../shared/manifest';
import { APP_IDS } from '@/platform/kernel/abi';

export const notepadManifest = defineApp({
  id: APP_IDS.notepad,
  name: text('المفكرة', 'Bloc-notes', 'Notepad'),
  description: text(
    'تحرير الملفات النصية وملاحظات الإغلاق بعلامات تبويب وبحث واستبدال',
    'Éditer fichiers texte et notes de clôture, avec onglets et rechercher/remplacer',
    'Edit text files and close notes, with tabs and find & replace',
  ),
  category: 'productivity',
  icon: 'file-text',
  capabilities: ['fs.read', 'fs.write', 'registry.read', 'registry.write', 'clipboard', 'notify', 'window.manage'],
  defaultSize: { w: 900, h: 620 },
  minSize: { w: 480, h: 320 },
  keywords: ['notepad', 'text', 'editor', 'notes', 'markdown', 'bloc-notes', 'texte', 'مفكرة', 'نص', 'ملاحظات'],
  fileAssociations: [
    { contentType: 'text/plain', extensions: ['.txt', '.log', '.ini'] },
    { contentType: 'text/markdown', extensions: ['.md'] },
    { contentType: 'text/csv', extensions: ['.csv'] },
    { contentType: 'application/json', extensions: ['.json'] },
  ],
  jumpList: [
    { id: 'new', title: text('مستند جديد', 'Nouveau document', 'New document') },
    { id: 'open', title: text('فتح ملف…', 'Ouvrir un fichier…', 'Open file…') },
  ],
  commands: [
    { id: 'new', title: text('مستند جديد', 'Nouveau document', 'New document'), accelerator: 'Ctrl+N' },
    { id: 'open', title: text('فتح ملف…', 'Ouvrir un fichier…', 'Open file…'), accelerator: 'Ctrl+O' },
    { id: 'save', title: text('حفظ', 'Enregistrer', 'Save'), accelerator: 'Ctrl+S' },
    { id: 'find', title: text('بحث واستبدال', 'Rechercher et remplacer', 'Find and replace'), accelerator: 'Ctrl+F' },
    { id: 'wrap', title: text('التفاف النص', 'Retour à la ligne', 'Word wrap') },
  ],
});
