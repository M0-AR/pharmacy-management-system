/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        muted: 'hsl(var(--muted))',
        primary: 'hsl(var(--primary))',
        accent: 'hsl(var(--accent))',
        border: 'hsl(var(--border))',
      },
      borderRadius: { xl: '0.9rem', '2xl': '1.25rem' },
      boxShadow: { soft: '0 8px 30px rgb(0 0 0 / 0.06)' },
    },
  },
  plugins: [],
};
