/**
 * The document under the cursor, read out in full.
 *
 * `dmsDocument360` answers one RPC with seven collections, and this is the pane that spends
 * them: the document itself, its versions, what it is filed against, what it relates to, the
 * packages it has been sealed into, its history — and, in `fields.tsx` because that one is a
 * table inside a card, what an engine read out of it.
 *
 * Nothing here is a grid. `list.tsx` owns the six grids and their seventy columns; this pane is
 * the other half of that split, where one record is read rather than a thousand compared, so
 * the same fact is drawn as a property row or a chip instead of as a column. The two halves
 * share `cells.tsx` precisely so that a `reviewStatus` wears the same colour on both sides of
 * the splitter and a reviewer never has to ask whether the amber means the same thing.
 *
 * Four states, in the order a reader meets them: nothing selected, a report still arriving, a
 * report that came back with nothing, and a document. The middle two are not interchangeable.
 * `dashboard.tsx` sets the rule this copies — a report that has not arrived is drawn as
 * *arriving*, never as *empty* — because an empty state over a loading pane reads as "there is
 * nothing on this document", and a reviewer who believes that closes the pane and moves on.
 *
 * The warnings sit above everything else on purpose. Each of them — a lapsing expiry, an
 * archived record, a current version whose bytes never landed, a package whose seal no longer
 * describes what it attested to — is a reason not to trust what the rest of the pane says, and
 * a reviewer needs those before they read a single property rather than after.
 */
import {
  Boxes,
  ExternalLink,
  Eye,
  FileText,
  Files,
  History,
  Link2,
  Network,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import {
  EmptyState,
  fmt,
  IconButton,
  InfoBar,
  PropertyRow,
  Section,
  Spinner,
  useLocale,
} from '@/platform/sdk';
import { Chip, Dash, Days, Hash, Seal, Stack, StateChip, TagList, Verified } from './cells';
import { DmsExtraction } from './fields';
import { actorLabel, int, size } from './format';
import {
  CONFIDENTIALITY_LABEL,
  DOC_RELATION_LABEL,
  humanize,
  LINK_ENTITY_LABEL,
  LINK_RELATION_LABEL,
  PACKAGE_LABEL,
  REVIEW_LABEL,
  UPLOAD_STATE_LABEL,
} from './labels';
import {
  CONFIDENTIALITY_TONE,
  eventTone,
  expiryTone,
  PACKAGE_TONE,
  REVIEW_TONE,
  UPLOAD_STATE_TONE,
} from './tones';
import type { DmsShell } from './shell';
import type {
  DmsDocument,
  DmsDocument360,
  DmsEvent,
  DmsLink,
  DmsMembership,
  DmsRelation,
  DmsVersion,
} from './types';

/** The pane itself: a column of sections, packed to the top so a short document does not stretch. */
const PANE: CSSProperties = { display: 'grid', gap: 14, alignContent: 'start', padding: 14 };

const CAPTION: CSSProperties = { color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' };

/** Chips, states and counts on one baseline, wrapping rather than clipping in a narrow pane. */
const WRAP: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' };

/**
 * One entry in a collection list.
 *
 * A rule above each entry rather than a card around it. Five of the six collections are lists of
 * short things — a version, a link, a relation, a package, an event — and five stacks of cards
 * down one pane would spend most of the width on borders.
 */
const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
  borderTop: '1px solid var(--fx-divider)',
  minWidth: 0,
};

interface DocProps {
  readonly doc: DmsDocument;
}

/**
 * Who this document is: its title, its number, and the four facts that qualify both.
 *
 * The number is the server's, assigned when the first version is finalized, so a document that
 * has never had bytes behind it shows a dash here — and that dash is the same one every nullable
 * cell in the app draws, which is the point of it being a shared component rather than a string.
 *
 * The two states and the type sit on one line beneath because a reviewer reads them together:
 * `APPROVED` on a `RESTRICTED` passport is a different situation from `APPROVED` on an `INTERNAL`
 * memo, and nothing about either is legible from the title. Tags follow them rather than getting
 * a row of their own — they are what a filer typed, not what the workspace decided.
 */
function Identity({ doc }: DocProps) {
  const { tr } = useLocale();
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
        <span style={{ fontSize: 'var(--fx-subtitle)', fontWeight: 600, minWidth: 0 }}>
          {doc.title === '' ? tr('بلا عنوان', 'Sans titre', 'Untitled') : doc.title}
        </span>
        {doc.documentNumber === null ? (
          <Dash />
        ) : (
          <span style={{ ...CAPTION, fontVariantNumeric: 'tabular-nums' }}>{doc.documentNumber}</span>
        )}
      </div>
      <div style={WRAP}>
        <StateChip value={doc.reviewStatus} tones={REVIEW_TONE} labels={REVIEW_LABEL} />
        <StateChip
          value={doc.confidentiality}
          tones={CONFIDENTIALITY_TONE}
          labels={CONFIDENTIALITY_LABEL}
        />
        <Chip text={humanize(doc.documentType)} />
        <TagList tags={doc.tags} max={4} />
      </div>
      {doc.description === '' ? null : (
        <p style={{ margin: 0, color: 'var(--fx-text-secondary)' }}>{doc.description}</p>
      )}
    </div>
  );
}

interface WarningsProps {
  readonly doc: DmsDocument;
  readonly versions: readonly DmsVersion[];
  readonly packages: readonly DmsMembership[];
}

/**
 * Everything a reviewer should know before reading the rest of the pane.
 *
 * Six bars, each drawn only when it has something to say, so the ordinary document shows none at
 * all and the presence of any bar is itself the signal. They are ordered by how much they
 * undermine what follows: a broken seal first, because it means the evidence no longer describes
 * what was attested to; then bytes that never landed, because the document opens to nothing; then
 * the dates; then the two pieces of prose a reviewer left behind.
 *
 * The expiry bar uses `expiryTone`'s fixed seven-and-thirty bands rather than this document's own
 * `expiryNoticeDays`, for the same reason the grid column does — the pane and the grid must not
 * disagree about the colour of the same number. `expiryNoticeDays` is what the server's sweep
 * notifies on, and it is read out below as a property rather than acted on here.
 */
function Warnings({ doc, versions, packages }: WarningsProps) {
  const { lang, tr } = useLocale();
  const days = doc.daysRemaining;
  const on = fmt.date(doc.expiresOn, lang);
  const count = days === null ? '' : int(Math.abs(days), lang);
  const current = versions.find((version) => version.isCurrent);
  const unfinalized =
    current !== undefined &&
    (current.uploadState === 'RESERVED' || current.uploadState === 'FAILED');
  const drifted = packages.filter(
    (member) => member.sealedVersionId !== null && member.sealedVersionId !== doc.currentVersionId,
  );
  return (
    <>
      {drifted.length === 0 ? null : (
        <InfoBar
          tone="danger"
          title={tr('ختم لم يعد مطابقًا', 'Sceau rompu', 'Seal no longer matches')}
        >
          {tr(
            'ختمت هذه الحزم نسخة أخرى من هذا المستند: ',
            'Ces dossiers ont scellé une autre version de ce document : ',
            'These packages sealed a different version of this document: ',
          )}
          {drifted.map((member) => member.name).join(' · ')}
        </InfoBar>
      )}
      {unfinalized ? (
        <InfoBar
          tone="warning"
          title={tr(
            'النسخة الحالية غير مكتملة',
            'Version courante inachevée',
            'Current version unfinalized',
          )}
        >
          {tr(
            'حُجز مسار تخزين ولم يصل الملف. فتح هذا المستند لن يُظهر شيئًا.',
            'Un chemin de stockage a été réservé mais le fichier n’est jamais arrivé. Ouvrir ce document ne montrera rien.',
            'A storage path was reserved but the file never arrived. Opening this document will show nothing.',
          )}
        </InfoBar>
      ) : null}
      {days === null || days > 30 ? null : (
        <InfoBar
          tone={expiryTone(days)}
          title={
            days < 0
              ? tr('انتهت الصلاحية', 'Expiré', 'Expired')
              : tr('تنتهي الصلاحية قريبًا', 'Expire bientôt', 'Expiring soon')
          }
        >
          {days < 0
            ? tr(
                `انتهت في ${on} — تجاوزت ${count} يومًا.`,
                `Expiré le ${on} — ${count} jour(s) de retard.`,
                `Expired on ${on} — ${count} days past due.`,
              )
            : tr(
                `تنتهي في ${on} — يتبقّى ${count} يومًا.`,
                `Expire le ${on} — ${count} jour(s) restant(s).`,
                `Expires on ${on} — ${count} days remaining.`,
              )}
        </InfoBar>
      )}
      {doc.archivedAt === null ? null : (
        <InfoBar tone="neutral" title={tr('مؤرشف', 'Archivé', 'Archived')}>
          {fmt.dateTime(doc.archivedAt, lang)}
        </InfoBar>
      )}
      {doc.rejectionReason === '' ? null : (
        <InfoBar tone="danger" title={tr('سبب الرفض', 'Motif du refus', 'Rejection reason')}>
          {doc.rejectionReason}
        </InfoBar>
      )}
      {doc.reviewNotes === '' ? null : (
        <InfoBar tone="info" title={tr('ملاحظات المراجعة', 'Notes de revue', 'Review notes')}>
          {doc.reviewNotes}
        </InfoBar>
      )}
    </>
  );
}

interface TitleProps {
  readonly icon: LucideIcon;
  readonly text: string;
}

/**
 * A section heading with a glyph in front of it.
 *
 * `Section` takes a `ReactNode` title and draws no icon of its own, so the glyph goes inside the
 * heading rather than beside it. Eight sections down one scroller need something for the eye to
 * count by — a reviewer scrolling to the history is looking for the clock, not reading headings.
 */
function Title({ icon: Glyph, text }: TitleProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <Glyph size={15} style={{ color: 'var(--fx-text-tertiary)' }} />
      {text}
    </span>
  );
}

interface CollectionProps extends TitleProps {
  readonly count: number;
  /** One line for the case where the collection is empty, which is not an error. */
  readonly empty: string;
  readonly children: ReactNode;
}

/**
 * One of the six collections: a heading, how many, and either the list or a line saying none.
 *
 * Written once because six sections repeating the same three decisions is six chances to
 * disagree about them. The count lives in `Section`'s action slot and is `undefined` when the
 * collection is empty — `Section` renders that slot on `!== undefined`, and a `0` next to
 * "no versions" says the same thing twice.
 *
 * The empty line is a sentence rather than an `EmptyState`, because eight stacked `EmptyState`s
 * on an untouched document would fill the pane with centred illustrations of nothing.
 */
function Collection({ icon, text, count, empty, children }: CollectionProps) {
  const { lang } = useLocale();
  return (
    <Section
      title={<Title icon={icon} text={text} />}
      action={count === 0 ? undefined : <span style={CAPTION}>{int(count, lang)}</span>}
    >
      {count === 0 ? <span style={CAPTION}>{empty}</span> : children}
    </Section>
  );
}

/**
 * The dates, the two people, and the counts.
 *
 * A property list rather than a row of tiles: eleven facts, most of them null on most documents,
 * and a tile that reads "—" is a tile spent saying nothing. Nothing here is guarded, because
 * `fmt.date` and `fmt.dateTime` already return an em dash for a null — that null-tolerance is
 * exactly why those two are used and `relativeTime`, which has none, is not.
 *
 * `expiryNoticeDays` is read out here rather than acted on. It is what the server's expiry sweep
 * notifies on, and the warning bar above deliberately bands on `expiryTone`'s fixed seven and
 * thirty instead, so that this pane and the grid never disagree about one number's colour.
 *
 * Both people are eight characters of a uuid, because `actorLabel` has nothing better to reach
 * for: `staff_profiles` is not a table the DMS datasets may join. Real names are a server change.
 */
function Lifecycle({ doc }: DocProps) {
  const { lang, tr } = useLocale();
  const notice = int(doc.expiryNoticeDays, lang);
  return (
    <Section title={<Title icon={FileText} text={tr('المسار', 'Cycle de vie', 'Lifecycle')} />}>
      <div style={{ display: 'grid' }}>
        <PropertyRow label={tr('الحالة', 'État', 'State')}>{humanize(doc.status)}</PropertyRow>
        <PropertyRow label={tr('صدر في', 'Émis le', 'Issued')}>
          {fmt.date(doc.issuedOn, lang)}
        </PropertyRow>
        <PropertyRow label={tr('ينتهي في', 'Expire le', 'Expires')}>
          <span style={WRAP}>
            {fmt.date(doc.expiresOn, lang)}
            {doc.expiresOn === null ? null : <Days days={doc.daysRemaining} on={doc.expiresOn} />}
          </span>
        </PropertyRow>
        <PropertyRow label={tr('تنبيه قبل', 'Préavis', 'Notice')}>
          {tr(`${notice} يومًا`, `${notice} jour(s)`, `${notice} days`)}
        </PropertyRow>
        <PropertyRow label={tr('قُدّم في', 'Soumis le', 'Submitted')}>
          {fmt.dateTime(doc.submittedAt, lang)}
        </PropertyRow>
        <PropertyRow label={tr('المراجع', 'Relecteur', 'Reviewer')}>
          {actorLabel(doc.reviewerId)}
        </PropertyRow>
        <PropertyRow label={tr('روجع في', 'Revu le', 'Reviewed')}>
          {fmt.dateTime(doc.reviewedAt, lang)}
        </PropertyRow>
        <PropertyRow label={tr('اعتُمد في', 'Approuvé le', 'Approved')}>
          {fmt.dateTime(doc.approvedAt, lang)}
        </PropertyRow>
        <PropertyRow label={tr('عدد النسخ', 'Nombre de versions', 'Versions')}>
          {int(doc.versionCount, lang)}
        </PropertyRow>
        <PropertyRow label={tr('أنشئ في', 'Créé le', 'Created')}>
          {fmt.dateTime(doc.createdAt, lang)}
        </PropertyRow>
        <PropertyRow label={tr('حُدّث في', 'Modifié le', 'Updated')}>
          {fmt.dateTime(doc.updatedAt, lang)}
        </PropertyRow>
        <PropertyRow label={tr('المساحة', 'Espace', 'Workspace')} mono>
          {doc.workspaceId}
        </PropertyRow>
      </div>
    </Section>
  );
}

interface VersionsProps extends DocProps {
  readonly versions: readonly DmsVersion[];
  readonly shell: DmsShell;
}

/**
 * The version chain, in the order the projection returned it.
 *
 * The current version is labelled rather than lifted out of the list, because the sequence is the
 * point: a reviewer looking at a superseded passport scan needs to see both that it is superseded
 * and which number replaced it. The filename leads each row and the version number sits in the
 * gutter — the filename is what a clerk recognizes, the number is what the system counts by.
 *
 * The eye opens a version through `shell.previewVersion`, which spends `docs.signedUrl` and
 * renders the result in-pane. It is offered on every row including the unfinalized ones: a
 * `RESERVED` version has a storage path, and the honest way to learn nothing is behind it is the
 * error the broker returns, not a button disabled on this pane's guess.
 */
function Versions({ doc, versions, shell }: VersionsProps) {
  const { lang, tr } = useLocale();
  const NUM: CSSProperties = { flex: 'none', textAlign: 'end', fontVariantNumeric: 'tabular-nums' };
  return (
    <Collection
      icon={Files}
      text={tr('النسخ', 'Versions', 'Versions')}
      count={versions.length}
      empty={tr('لا نسخ بعد.', 'Aucune version.', 'Nothing uploaded yet.')}
    >
      <div style={{ display: 'grid' }}>
        {versions.map((version) => (
          <div key={version.id} style={ROW}>
            <span style={{ ...NUM, width: 30, fontWeight: 600 }}>
              {`v${int(version.versionNumber, lang)}`}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Stack
                title={
                  version.originalFilename === ''
                    ? tr('ملف بلا اسم', 'Fichier sans nom', 'Unnamed file')
                    : version.originalFilename
                }
                caption={
                  version.isCurrent ? tr('الحالية', 'Courante', 'Current') : version.mimeType
                }
                hint={version.notes === '' ? version.storagePath : version.notes}
              />
            </div>
            <StateChip
              value={version.uploadState}
              tones={UPLOAD_STATE_TONE}
              labels={UPLOAD_STATE_LABEL}
            />
            <span style={{ ...CAPTION, ...NUM, width: 68 }}>{size(version.sizeBytes, lang)}</span>
            <span
              style={{ ...CAPTION, ...NUM, width: 34 }}
              title={tr('الصفحات', 'Pages', 'Pages')}
            >
              {int(version.pageCount, lang)}
            </span>
            <Hash hash={version.checksumSha256} />
            <Verified ok={version.uploadState !== 'RESERVED' && version.uploadState !== 'FAILED'} />
            <IconButton
              icon={Eye}
              label={tr('عرض', 'Aperçu', 'Preview')}
              onClick={() => shell.previewVersion(doc.id, doc.title, version)}
              size={14}
            />
          </div>
        ))}
      </div>
    </Collection>
  );
}

interface LinksProps {
  readonly links: readonly DmsLink[];
  readonly shell: DmsShell;
}

/**
 * What this document is filed against.
 *
 * Each row's heading is the claim the filer made, read as a sentence — "Evidence for · Booking" —
 * which is why `LINK_ENTITY_LABEL` holds singular nouns and `LINK_RELATION_LABEL` holds verbs.
 * Both are indexed directly rather than passed through `labelFor`, because both are exhaustive
 * over their union and the compiler can check the lookup; `labelFor` erases the key to `string`
 * and would hide a missing entry until it rendered to a clerk.
 *
 * The arrow appears only where `shell.canOpenEntity` says an app can actually receive the link.
 * Three of the seventeen entity types have an app that reads launch arguments; a `journal_entry`
 * link could launch the Journal but not aim it at the entry, and a click that lands a reviewer on
 * an unrelated ledger is worse than no click. The slot keeps its width either way so the dates
 * stay in a column.
 */
function Links({ links, shell }: LinksProps) {
  const { lang, t, tr } = useLocale();
  return (
    <Collection
      icon={Link2}
      text={tr('مرتبط بـ', 'Rattaché à', 'Filed against')}
      count={links.length}
      empty={tr(
        'غير مرتبط بأي سجل.',
        'Rattaché à aucun enregistrement.',
        'Not filed against anything.',
      )}
    >
      <div style={{ display: 'grid' }}>
        {links.map((link) => (
          <div key={link.id} style={ROW}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Stack
                title={`${t(LINK_RELATION_LABEL[link.relation])} · ${t(LINK_ENTITY_LABEL[link.entityType])}`}
                caption={link.note === '' ? link.entityId : link.note}
                hint={link.entityId}
              />
            </div>
            <span style={CAPTION}>{fmt.date(link.createdAt, lang)}</span>
            <span
              style={{ flex: 'none', width: 24, display: 'inline-flex', justifyContent: 'center' }}
            >
              {shell.canOpenEntity(link) ? (
                <IconButton
                  icon={ExternalLink}
                  label={tr('فتح السجل', 'Ouvrir la fiche', 'Open record')}
                  onClick={() => shell.openEntity(link)}
                  size={14}
                />
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </Collection>
  );
}

interface RelationsProps {
  readonly relations: readonly DmsRelation[];
}

/**
 * What this document is filed against in its own kind — other documents.
 *
 * Direction is stated as a word rather than drawn as an arrow. `dms_document_relations` is a
 * directed edge, and the difference between this document superseding that one and that one
 * superseding this is the whole content of the row; an arrow would have to flip under RTL and a
 * mirrored glyph is a poor place to keep a fact that matters this much. Naming the direction and
 * the verb separately also avoids inventing an inverse for each of the seven relations —
 * `SUPERSEDES` has one, `TRANSLATION_OF` does not.
 *
 * The other document's review state travels with it because a `SUPERSEDES` edge pointing at a
 * rejected draft and one pointing at an approved original are different situations, and this pane
 * is the only place the two documents are visible together.
 */
function Relations({ relations }: RelationsProps) {
  const { t, tr } = useLocale();
  return (
    <Collection
      icon={Network}
      text={tr('مستندات ذات صلة', 'Documents liés', 'Related documents')}
      count={relations.length}
      empty={tr('لا مستندات مرتبطة.', 'Aucun document lié.', 'No related documents.')}
    >
      <div style={{ display: 'grid' }}>
        {relations.map((relation) => {
          const way =
            relation.direction === 'OUTGOING'
              ? tr('من هذا المستند', 'Depuis ce document', 'From this document')
              : tr('إلى هذا المستند', 'Vers ce document', 'Toward this document');
          return (
            <div key={relation.id} style={ROW}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Stack
                  title={
                    relation.title === ''
                      ? tr('بلا عنوان', 'Sans titre', 'Untitled')
                      : relation.title
                  }
                  caption={`${way} · ${t(DOC_RELATION_LABEL[relation.relation])}`}
                  hint={relation.documentNumber ?? relation.documentId}
                />
              </div>
              {relation.documentNumber === null ? (
                <Dash />
              ) : (
                <span style={{ ...CAPTION, fontVariantNumeric: 'tabular-nums' }}>
                  {relation.documentNumber}
                </span>
              )}
              <StateChip
                value={relation.reviewStatus}
                tones={REVIEW_TONE}
                labels={REVIEW_LABEL}
              />
            </div>
          );
        })}
      </div>
    </Collection>
  );
}

interface PackagesProps extends DocProps {
  readonly packages: readonly DmsMembership[];
}

/**
 * The evidence packages this document has been sealed into.
 *
 * The seal is the reading the whole packaging subsystem exists for, and it is computed here rather
 * than read off the row: `sealedVersionId` is the version that was current at the moment of
 * sealing, so comparing it against the document's `currentVersionId` *is* the test. `null` stays a
 * dash, because an open package has sealed nothing and a green chip there would be a claim nobody
 * made.
 *
 * The drift count passed to `Seal` is `1` on a broken row, and that is literal rather than a
 * placeholder: exactly one member of that package — this document — no longer matches what was
 * attested to. The packages grid passes the same component a package-wide count, which is the same
 * question asked from the other side.
 */
function Packages({ doc, packages }: PackagesProps) {
  const { lang, tr } = useLocale();
  return (
    <Collection
      icon={Boxes}
      text={tr('الحزم', 'Dossiers', 'Packages')}
      count={packages.length}
      empty={tr('لم يُدرج في أي حزمة.', 'Dans aucun dossier.', 'Not in any package.')}
    >
      <div style={{ display: 'grid' }}>
        {packages.map((member) => {
          const matches =
            member.sealedVersionId === null
              ? null
              : member.sealedVersionId === doc.currentVersionId;
          return (
            <div key={member.id} style={ROW}>
              <span
                style={{ ...CAPTION, flex: 'none', width: 26, textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}
                title={tr('الترتيب في الحزمة', 'Rang dans le dossier', 'Sequence in package')}
              >
                {int(member.sequenceNo, lang)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Stack
                  title={member.name === '' ? member.reference : member.name}
                  caption={member.name === '' ? null : member.reference}
                  hint={member.reference}
                />
              </div>
              <StateChip value={member.status} tones={PACKAGE_TONE} labels={PACKAGE_LABEL} />
              <Seal matches={matches} drifted={matches === false ? 1 : 0} />
              <span style={CAPTION}>{fmt.date(member.sealedAt, lang)}</span>
            </div>
          );
        })}
      </div>
    </Collection>
  );
}

interface TimelineProps {
  /** `DmsDocument360.events`, in whatever order the projection returned them. */
  readonly events: readonly DmsEvent[];
}

/**
 * Everything the ledger recorded about this document.
 *
 * The transition is spelled with a word rather than an arrow, for the reason `Relations` gives:
 * `→` does not mirror itself, and the flex row it would sit in *does* flip under RTL, so the glyph
 * would end up pointing from the destination back to the origin. `from vers to` reads correctly in
 * all three languages and needs no bidi thought at all.
 *
 * A creation event has no `fromState`, so it shows only where it landed. An event with neither
 * state nor detail is not malformed — some event types are the whole fact, and the chip is then
 * the entire row.
 *
 * The actor's role is a tooltip rather than a column: `actorLabel` already resolves the id to
 * something readable, and a second identity column would double the width for a fact that only
 * matters when somebody is chasing who was allowed to do this.
 */
function Timeline({ events }: TimelineProps) {
  const { lang, tr } = useLocale();
  const toward = tr('إلى', 'vers', 'to');
  return (
    <Collection
      icon={History}
      text={tr('السجل', 'Historique', 'History')}
      count={events.length}
      empty={tr('لا أحداث مسجّلة.', 'Aucun événement enregistré.', 'No events recorded.')}
    >
      <div style={{ display: 'grid' }}>
        {events.map((event) => {
          const from = event.fromState === null ? '' : humanize(event.fromState);
          const into = event.toState === null ? '' : humanize(event.toState);
          const move = from === '' ? into : `${from} ${toward} ${into}`;
          return (
            <div key={event.id} style={ROW}>
              <Chip
                text={humanize(event.eventType)}
                tone={eventTone(event.toState, event.eventType)}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Stack
                  title={move === '' ? event.detail : move}
                  caption={move === '' || event.detail === '' ? null : event.detail}
                  hint={event.detail === '' ? undefined : event.detail}
                />
              </div>
              <span style={{ ...CAPTION, flex: 'none' }} title={event.actorRole ?? undefined}>
                {actorLabel(event.actorId)}
              </span>
              <span style={{ ...CAPTION, flex: 'none' }}>{fmt.dateTime(event.createdAt, lang)}</span>
            </div>
          );
        })}
      </div>
    </Collection>
  );
}

interface BodyProps {
  readonly full: DmsDocument360;
  readonly shell: DmsShell;
}

/**
 * The whole report, in the order a reviewer reads it.
 *
 * Identity, then the warnings, then the properties, then the six collections. The order is an
 * argument: who this is, what would stop you trusting the rest, what the record says about itself,
 * and only then what hangs off it. Extraction goes last because it is the only section a reviewer
 * *works* in rather than reads — a verdict per field, forty rows deep — and putting it above the
 * history would bury every reading beneath a task.
 *
 * Each section takes the collection it draws rather than the 360, so this is the one function that
 * knows the report's shape and each section stays droppable anywhere the same list is in hand.
 * `Warnings` and `Packages` take the document too, because both of them ask the same question of
 * it: does the seal still describe the version that is current now.
 */
function Body({ full, shell }: BodyProps) {
  const doc = full.document;
  return (
    <div style={PANE}>
      <Identity doc={doc} />
      <Warnings doc={doc} versions={full.versions} packages={full.packages} />
      <Lifecycle doc={doc} />
      <Versions doc={doc} versions={full.versions} shell={shell} />
      <Links links={full.links} shell={shell} />
      <Relations relations={full.relations} />
      <Packages doc={doc} packages={full.packages} />
      <Timeline events={full.events} />
      <DmsExtraction jobs={full.jobs} shell={shell} />
    </div>
  );
}

/** The arriving state, centred in the pane. Copied from `dashboard.tsx` so the two agree. */
const LOADING: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  justifyContent: 'center',
  padding: 32,
  color: 'var(--fx-text-secondary)',
};

export interface DmsDetailProps {
  readonly shell: DmsShell;
}

/**
 * The inspector, and the four states it can be in.
 *
 * Nothing selected is its own state and not an empty report: a reviewer who has just opened the
 * window has selected nothing, and telling them the document has no history would be a lie about a
 * document they have not chosen yet.
 *
 * A report belonging to another document is treated as *arriving*, not as this one's. `selectedId`
 * changes the instant a row is clicked and the RPC answers some milliseconds later, so for those
 * milliseconds `model.selected.value` still holds the previous document — and drawing it under the
 * new row's highlight would show one document's versions, seals and history while claiming to be
 * another. That is worse than a spinner by exactly the amount a reviewer trusts this pane.
 *
 * The failure case says the report is missing and not why. Why is `model.selected.error`, and the
 * status bar is already showing it.
 */
export function DmsDetail({ shell }: DmsDetailProps) {
  const { tr } = useLocale();
  const { value, loading } = shell.model.selected;
  const id = shell.selectedId;
  if (id === null) {
    return (
      <EmptyState
        icon={FileText}
        title={tr('لا مستند محدد', 'Aucun document sélectionné', 'No document selected')}
        description={tr(
          'اختر صفًا من القائمة لقراءته كاملًا.',
          'Sélectionnez une ligne de la liste pour la lire en entier.',
          'Pick a row from the list to read it in full.',
        )}
      />
    );
  }
  const other = value !== null && value.document.id !== id;
  if (value === null || other) {
    return loading || other ? (
      <div style={LOADING}>
        <Spinner size={18} />
        <span>{tr('يجري قراءة التقرير…', 'Lecture du rapport…', 'Reading the report…')}</span>
      </div>
    ) : (
      <EmptyState
        icon={FileText}
        title={tr('لا تقرير', 'Aucun rapport', 'No report')}
        description={tr(
          'لم يُقرأ هذا المستند. أعد المحاولة من شريط الأدوات.',
          'Ce document n’a pas été lu. Réessayez depuis la barre d’outils.',
          'This document was not read. Try again from the toolbar.',
        )}
      />
    );
  }
  return <Body full={value} shell={shell} />;
}
