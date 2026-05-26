/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm amber accent: rgb(231, 167, 121) = #E7A779 as primary-600
        primary: {
          50:  '#fff9f4',
          100: '#feeee0',
          200: '#fcd9ba',
          300: '#f8be90',
          400: '#f2a06a',
          500: '#ec8d4c',
          600: '#E7A779',   // warm amber
          700: '#cc8a52',
          800: '#a86c3b',
          900: '#87532d',
          950: '#4e2e14',
        },
      },
      keyframes: {
        'fade-in': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out',
      },
    },
  },
  plugins: [],
}
