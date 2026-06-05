/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f4ff',
          100: '#e0e9ff',
          500: '#4f6ef7',
          600: '#3a5be8',
          700: '#2d4dd4',
        },
        surface: '#f8f9fb',
        panel: '#ffffff',
        border: '#e5e7eb',
      },
    },
  },
  plugins: [],
}
