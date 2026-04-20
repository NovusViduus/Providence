/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        providence: {
          bg:              '#0C1017',
          surface:         '#131A24',
          'surface-hover': '#1C2333',
          'surface-raised':'#252D3F',
          border:          '#1E2A3A',
          'border-active': '#2A3650',
          'border-focus':  '#374A6B',
          accent:          '#0A9396',
          'accent-bright': '#2EC4B6',
          'accent-dim':    '#0A939630',
          danger:          '#D64045',
          warn:            '#CC8B17',
          info:            '#4A7AB5',
        },
        steel: {
          50:  '#E2E8F0',
          100: '#C9D1D9',
          200: '#8B949E',
          300: '#6B7B8D',
          400: '#4D5B6A',
          500: '#374A5E',
          600: '#283548',
        },
      },
    },
  },
  plugins: [],
};
