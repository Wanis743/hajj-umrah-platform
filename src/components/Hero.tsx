/**
 * The hero.
 *
 * Two fixes here are not cosmetic. `min-h-screen` resolves to `100vh`, which
 * on mobile Safari and Chrome is the viewport *without* browser chrome — the
 * hero was roughly a toolbar taller than the screen, so its trust row and
 * scroll cue sat underneath the address bar on every phone. `.gl-screen-h`
 * uses `svh` with a `vh` fallback. And the backdrop was a single 1920px JPEG
 * served to a 375px phone; it now ships a `srcSet` so a phone fetches ~640px.
 *
 * The type is fluid (`text-fluid-display`) rather than stepped through four
 * breakpoints, which is what removes the jumps at 640/768/1024 where the
 * headline used to break awkwardly for a few dozen pixels either side.
 */
import { ArrowLeft, Calendar, Clock, ShieldCheck, Users } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useRouter } from '@/router/RouterProvider';

const PHOTO = 'https://images.pexels.com/photos/26436662/pexels-photo-26436662.jpeg?auto=compress&cs=tinysrgb';

const TRUST = [
  { icon: Users, key: 'pilgrims' as const, value: '+٥٠٠٠' },
  { icon: ShieldCheck, key: 'experience' as const, value: '+١٥' },
  { icon: Clock, key: null, value: '٢٤/٧' },
];

export default function Hero() {
  const { t, dir } = useI18n();
  const { navigate } = useRouter();
  const arrowClass =
    dir === 'rtl'
      ? 'h-4 w-4 shrink-0 transition-transform group-hover:-translate-x-1'
      : 'h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1';

  return (
    <section
      id="home"
      className="gl-screen-h gl-stack flex items-center justify-center overflow-hidden pt-24 pb-16 sm:pt-28"
    >
      <div className="absolute inset-0 -z-10">
        <img
          src={`${PHOTO}&w=1920`}
          srcSet={`${PHOTO}&w=640 640w, ${PHOTO}&w=1024 1024w, ${PHOTO}&w=1600 1600w, ${PHOTO}&w=1920 1920w`}
          sizes="100vw"
          alt=""
          fetchPriority="high"
          decoding="async"
          className="animate-slow-zoom h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-sand-950/80 via-sand-950/55 to-sand-950/90" />
        {/* A touch of colour under the glass so the frosted chips have
            something to refract instead of flat brown. */}
        <div className="absolute inset-0 bg-[radial-gradient(75%_55%_at_50%_18%,rgba(63,138,91,0.22),transparent_70%)]" />
      </div>

      <div className="mx-auto w-full max-w-4xl px-4 text-center sm:px-6">
        <p className="gl-chip gl-chip-onimage animate-fade-in mb-5 px-4 py-2 text-xs font-medium sm:text-sm">
          {t.hero.badge}
        </p>
        <h1 className="animate-fade-up font-serif text-fluid-display font-bold text-white text-balance [animation-delay:80ms]">
          {t.hero.title}
        </h1>
        <p className="animate-fade-up mx-auto mt-5 max-w-2xl text-fluid-lead text-sand-100 text-balance [animation-delay:180ms]">
          {t.hero.subtitle}
        </p>

        <div className="animate-fade-up mt-8 flex flex-col items-stretch justify-center gap-3 [animation-delay:280ms] sm:flex-row sm:items-center">
          <button
            onClick={() => navigate('reserve')}
            className="gl-btn gl-btn-primary group w-full px-7 text-base sm:w-auto"
          >
            {t.hero.cta}
            <ArrowLeft className={arrowClass} aria-hidden="true" />
          </button>
          <a href="#packages" className="gl-btn gl-btn-onimage w-full px-7 text-base sm:w-auto">
            <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t.hero.explore}
          </a>
        </div>

        {/* Trust row. Three glass tiles on a phone (a 3-up grid that stays
            readable at 320px) and one inline row from `sm` up, where the
            tiles drop their frame and become plain text. */}
        <ul className="animate-fade-up mt-10 grid grid-cols-3 gap-2 text-sand-100 [animation-delay:380ms] sm:mt-12 sm:flex sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-8 sm:gap-y-3">
          {TRUST.map((row) => (
            <li
              key={row.value}
              className="gl-tile flex flex-col items-center gap-1 px-2 py-3 text-center text-[11px] sm:flex-row sm:gap-1.5 sm:border-0 sm:bg-transparent sm:p-0 sm:text-sm sm:shadow-none sm:backdrop-blur-none"
            >
              <row.icon className="h-4 w-4 shrink-0 text-oasis-300" aria-hidden="true" />
              <span className="leading-tight">
                {row.key === null ? '' : `${t.trust[row.key]} `}
                <span className="font-semibold text-white">{row.value}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div
        className="absolute inset-x-0 z-10 flex justify-center"
        style={{ bottom: 'max(1.25rem, env(safe-area-inset-bottom, 0px))' }}
        aria-hidden="true"
      >
        <div className="flex h-9 w-6 items-start justify-center rounded-full border-2 border-white/55 p-1.5">
          <span className="h-2 w-1 animate-bounce rounded-full bg-white/85" />
        </div>
      </div>
    </section>
  );
}
