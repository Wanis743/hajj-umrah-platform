/**
 * Notepad — manifest.
 *
 * The associations are the important half. `handlerFor` is first-match-wins over
 * the installed manifests, so whatever Notepad claims here is what a double-click
 * on the desktop opens — and by claiming `text/plain`, `text/markdown` and
 * `application/json` it becomes the default opener for everything in the image
 * that is text and is not a spreadsheet or a ledger document.
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
