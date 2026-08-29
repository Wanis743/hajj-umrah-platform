/**
 * The section header every homepage band shares.
 *
 * It existed eleven times, copy-pasted, each copy stepping its own type
 * through `text-2xl sm:text-3xl md:text-4xl`. That is three hard jumps and
 * three widths on either side of them where the line breaks badly. One
 * `text-fluid-title` clamp replaces all of it and is right at every width.
 *
 * The eyebrow is a glass chip rather than plain coloured text, which is the
 * one place the section frame is allowed to announce itself.
 */
interface Props {
  readonly badge: string;
  readonly title: string;
  readonly subtitle?: string;
  /** Left-aligned when the band is a two-column layout rather than a grid. */
  readonly align?: 'center' | 'start';
}

export default function SectionHeading({ badge, title, subtitle, align = 'center' }: Props) {
  const centred = align === 'center';
  return (
    <div className={centred ? 'mx-auto max-w-3xl text-center' : 'max-w-2xl'}>
      <span className="gl-chip px-3.5 py-1.5 text-xs font-semibold tracking-wide text-oasis-700 dark:text-oasis-300">
        {badge}
      </span>
      <h2 className="mt-4 font-serif text-fluid-title font-bold text-sand-900 text-balance dark:text-white">
        {title}
      </h2>
      {subtitle !== undefined && (
        <p
          className={`mt-4 text-fluid-lead text-sand-700 text-balance dark:text-sand-300 ${
            centred ? 'mx-auto' : ''
          }`}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}
