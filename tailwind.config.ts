import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        jarvis: {
          bg: '#05070b',
          glass: 'rgba(255,255,255,0.06)',
          stroke: 'rgba(255,255,255,0.14)',
          accent: '#7cc8ff',
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
} satisfies Config;
