import containerQueries from '@tailwindcss/container-queries';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    // Declared in full (not via `extend`) so `xs` sorts *before* `sm` in the
    // generated cascade. Appending it through `extend` would emit `xs:` rules
    // after `2xl:` and let a 420px rule beat every larger breakpoint.
    screens: {
      xs: '420px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      fontFamily: {
        sans: ['Tajawal', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['Amiri', 'Georgia', 'serif'],
        mono: ['SF Mono', 'Fira Code', 'Consolas', 'monospace'],
        arabic: ['Tajawal', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        sand: {
          50: '#fbf7f0', 100: '#f5ecdc', 200: '#e8d6b8', 300: '#d9bb8a',
          400: '#c89a5e', 500: '#b6823f', 600: '#9d6a33', 700: '#7e522b',
          800: '#5f3f28', 900: '#3d2a1c', 950: '#2a1d13',
        },
        oasis: {
          50: '#f0f7f1', 100: '#dcefe0', 200: '#bce0c4', 300: '#8fcaa0',
          400: '#5fa978', 500: '#3f8a5b', 600: '#2e6e47', 700: '#26593a',
          800: '#1f4830', 900: '#163a26', 950: '#0d2417',
        },
        gold: { 400: '#e0b65a', 500: '#c99a3e', 600: '#a87d2e' },
        brand: {
          50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd',
          400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8',
          800: '#1e40af', 900: '#1e3a8a',
        },
        surface: {
          50: '#fafafa', 100: '#f5f5f5', 200: '#e5e5e5', 300: '#d4d4d4',
          400: '#a3a3a3', 500: '#737373', 600: '#525252', 700: '#404040',
          800: '#262626', 900: '#171717', 950: '#0a0a0a',
        },
        success: { 50: '#f0fdf4', 100: '#dcfce7', 500: '#22c55e', 600: '#16a34a' },
        warning: { 50: '#fffbeb', 100: '#fef3c7', 500: '#f59e0b', 600: '#d97706' },
        danger: { 50: '#fef2f2', 100: '#fee2e2', 500: '#ef4444', 600: '#dc2626' },
        info: { 50: '#eff6ff', 100: '#dbeafe', 500: '#3b82f6', 600: '#2563eb' },
      },
      // Warm shadows: the site is sand/oasis, so a neutral grey drop shadow
      // reads as grime on a cream surface. These are tinted with sand-900.
      boxShadow: {
        'xs': '0 1px 2px rgba(61,42,28,0.06)',
        'sm': '0 1px 3px rgba(61,42,28,0.09), 0 1px 2px rgba(61,42,28,0.05)',
        'md': '0 4px 10px -2px rgba(61,42,28,0.10), 0 2px 5px -2px rgba(61,42,28,0.07)',
        'lg': '0 12px 28px -10px rgba(61,42,28,0.20), 0 4px 10px -5px rgba(61,42,28,0.10)',
        'xl': '0 24px 55px -18px rgba(61,42,28,0.28), 0 8px 18px -10px rgba(61,42,28,0.14)',
        '2xl': '0 44px 100px -30px rgba(42,29,19,0.38), 0 12px 28px -14px rgba(42,29,19,0.20)',
        // Glass surfaces carry their lift *and* a top sheen in one declaration.
        'glass': '0 8px 24px -10px rgba(61,42,28,0.22), 0 2px 6px -3px rgba(61,42,28,0.12), inset 0 1px 0 rgba(255,255,255,0.75)',
        'glass-lg': '0 26px 60px -22px rgba(61,42,28,0.30), 0 6px 18px -10px rgba(61,42,28,0.16), inset 0 1px 0 rgba(255,255,255,0.8)',
        'glow-oasis': '0 10px 30px -8px rgba(63,138,91,0.45)',
        'glow-gold': '0 10px 30px -8px rgba(201,154,62,0.42)',
      },
      borderRadius: { 'sm': '5px', 'md': '8px', 'lg': '11px', 'xl': '14px', '2xl': '18px', '3xl': '24px', '4xl': '32px' },
      backdropBlur: { xs: '2px' },
      transitionTimingFunction: {
        glass: 'cubic-bezier(0.22, 1, 0.36, 1)',
        spring: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
      },
      // Fluid type: one declaration that is correct from a 320px phone to a
      // 4K monitor, instead of four breakpoint jumps that are each wrong in
      // the gaps between them.
      fontSize: {
        'fluid-display': ['clamp(1.95rem, 1.05rem + 4.4vw, 4.5rem)', { lineHeight: '1.08', letterSpacing: '-0.015em' }],
        'fluid-title': ['clamp(1.45rem, 1.05rem + 1.9vw, 2.5rem)', { lineHeight: '1.18' }],
        'fluid-lead': ['clamp(0.98rem, 0.9rem + 0.55vw, 1.3rem)', { lineHeight: '1.72' }],
        'fluid-num': ['clamp(1.35rem, 0.6rem + 3.4vw, 3.5rem)', { lineHeight: '1' }],
      },
      spacing: {
        'safe-top': 'env(safe-area-inset-top, 0px)',
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
        'safe-left': 'env(safe-area-inset-left, 0px)',
        'safe-right': 'env(safe-area-inset-right, 0px)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'slide-up': { '0%': { opacity: '0', transform: 'translateY(4px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        // These four were referenced by class name across the app but never
        // defined, so the animations they name silently did nothing.
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(18px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'slow-zoom': { '0%': { transform: 'scale(1)' }, '100%': { transform: 'scale(1.12)' } },
        'slide-in': { '0%': { opacity: '0', transform: 'translateX(24px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        'float': { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-9px)' } },
        'sheen': { '0%': { transform: 'translateX(-120%)' }, '100%': { transform: 'translateX(220%)' } },
        'pop': { '0%': { opacity: '0', transform: 'scale(0.94) translateY(8px)' }, '100%': { opacity: '1', transform: 'scale(1) translateY(0)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.5s cubic-bezier(0.22,1,0.36,1) both',
        'slide-up': 'slide-up 0.2s ease-out',
        'fade-up': 'fade-up 0.75s cubic-bezier(0.22,1,0.36,1) both',
        'slow-zoom': 'slow-zoom 22s cubic-bezier(0.22,1,0.36,1) alternate infinite',
        'slide-in': 'slide-in 0.3s cubic-bezier(0.22,1,0.36,1) both',
        'float': 'float 7s cubic-bezier(0.45,0,0.55,1) infinite',
        'pop': 'pop 0.28s cubic-bezier(0.34,1.4,0.64,1) both',
      },
    },
  },
  // containerQueries: vendored @bklit chart center typography uses
  // `@container/chart-center` + `cqw` clamp units so donut stats scale with the hole.
  plugins: [containerQueries],
};