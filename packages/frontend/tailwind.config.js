/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        gold: {
          DEFAULT: '#F5C518',
          50:  '#FFFAE5',
          100: '#FFF3B8',
          200: '#FFEB82',
          300: '#FFE04C',
          400: '#FFD41A',
          500: '#F5C518',
          600: '#C99E06',
          700: '#9A7904',
          800: '#6B5403',
          900: '#3D2F01',
        },
        dark: {
          DEFAULT: '#0a0a0a',
          50:  '#1a1a1a',
          100: '#141414',
          200: '#0f0f0f',
          300: '#0a0a0a',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Impact', 'Arial Black', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'gold-gradient': 'linear-gradient(135deg, #F5C518 0%, #C99E06 100%)',
        'dark-gradient': 'linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%)',
        'hero-gradient': 'linear-gradient(180deg, #0a0a0a 0%, #1a1a1a 50%, #0a0a0a 100%)',
      },
      boxShadow: {
        gold: '0 0 20px rgba(245, 197, 24, 0.4)',
        'gold-lg': '0 0 40px rgba(245, 197, 24, 0.6)',
        'dark': '0 4px 24px rgba(0, 0, 0, 0.8)',
      },
      animation: {
        'pulse-gold': 'pulse-gold 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slide-up 0.3s ease-out',
        'fade-in': 'fade-in 0.5s ease-out',
      },
      keyframes: {
        'pulse-gold': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(245, 197, 24, 0.4)' },
          '50%': { boxShadow: '0 0 40px rgba(245, 197, 24, 0.8)' },
        },
        'slide-up': {
          from: { transform: 'translateY(10px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
