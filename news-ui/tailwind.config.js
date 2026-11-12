/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        cockpit: {
          bg: '#070b14',
          panel: '#0b1220',
          card: '#101827',
          line: '#223047',
        },
        signal: {
          blue: '#4aa3ff',
          amber: '#f6b44b',
        },
      },
      boxShadow: {
        cockpit: '0 24px 80px rgba(0, 0, 0, 0.34)',
        glow: '0 0 0 1px rgba(74, 163, 255, 0.18), 0 18px 50px rgba(13, 87, 168, 0.18)',
      },
    },
  },
  plugins: [],
};
