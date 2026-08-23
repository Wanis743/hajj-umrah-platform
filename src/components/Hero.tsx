import { ArrowLeft, Calendar, Users, ShieldCheck, Clock } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useRouter } from '@/router/RouterProvider';

export default function Hero() {
  const { t, dir } = useI18n();
  const { navigate } = useRouter();
  const arrowClass = dir === 'rtl' ? 'h-4 w-4 transition-transform group-hover:-translate-x-1' : 'h-4 w-4 transition-transform group-hover:translate-x-1';

  return (
    <section id="home" className="relative flex min-h-screen items-center justify-center overflow-hidden">
      <div className="absolute inset-0">
        <img
          src="https://images.pexels.com/photos/26436662/pexels-photo-26436662.jpeg?auto=compress&cs=tinysrgb&w=1920"
          alt=""
          className="h-full w-full object-cover animate-slow-zoom"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-sand-950/80 via-sand-950/60 to-sand-950/85" />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl px-4 text-center sm:px-6">
        <p className="mb-5 inline-block animate-fade-in rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-sand-100 backdrop-blur-sm sm:text-sm">
          {t.hero.badge}
        </p>
        <h1 className="animate-fade-up font-serif text-3xl font-bold leading-tight text-white text-balance sm:text-4xl md:text-5xl lg:text-7xl">
          {t.hero.title}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl animate-fade-up text-base leading-7 text-sand-100 text-balance sm:text-lg md:text-xl md:leading-8">
          {t.hero.subtitle}
        </p>
        <div className="mt-9 flex animate-fade-up flex-col items-center justify-center gap-3 sm:flex-row">
          <button
            onClick={() => navigate('reserve')}
            className="group flex w-full items-center justify-center gap-2 rounded-full bg-oasis-500 px-7 py-3.5 text-base font-semibold text-white shadow-lg transition-all hover:bg-oasis-400 hover:shadow-xl sm:w-auto"
          >
            {t.hero.cta}
            <ArrowLeft className={arrowClass} />
          </button>
          <a
            href="#packages"
            className="flex w-full items-center justify-center gap-2 rounded-full bg-white/15 px-7 py-3.5 text-base font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/25 sm:w-auto"
          >
            <Calendar className="h-4 w-4" />
            {t.hero.explore}
          </a>
        </div>

        {/* Trust indicators */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-sand-200">
          <span className="flex items-center gap-1.5">
            <Users className="h-4 w-4 text-oasis-400" /> {t.trust.pilgrims} +٥٠٠٠
          </span>
          <span className="hidden h-4 w-px bg-sand-700 sm:block" />
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-oasis-400" /> {t.trust.experience} +١٥
          </span>
          <span className="hidden h-4 w-px bg-sand-700 sm:block" />
          <span className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-oasis-400" /> ٢٤/٧
          </span>
        </div>
      </div>

      <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
        <div className="flex h-9 w-6 items-start justify-center rounded-full border-2 border-white/60 p-1.5">
          <span className="h-2 w-1 animate-bounce rounded-full bg-white/80" />
        </div>
      </div>
    </section>
  );
}
