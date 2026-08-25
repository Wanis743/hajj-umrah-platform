import containerQueries from '@tailwindcss/container-queries';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
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
      boxShadow: {
        'xs': '0 1px 2px rgba(0,0,0,0.05)',
        'sm': '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)',
        'md': '0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06)',
      },
      borderRadius: { 'sm': '4px', 'md': '6px', 'lg': '8px', 'xl': '12px' },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'slide-up': { '0%': { opacity: '0', transform: 'translateY(4px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: { 'fade-in': 'fade-in 0.15s ease-out', 'slide-up': 'slide-up 0.2s ease-out' },
    },
  },
  // containerQueries: vendored @bklit chart center typography uses
  // `@container/chart-center` + `cqw` clamp units so donut stats scale with the hole.
  plugins: [containerQueries],
};