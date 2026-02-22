/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Jarvis pixel palette
        'pixel-green': '#50fa7b',
        'pixel-pink': '#ff79c6',
        'pixel-cyan': '#8be9fd',
        'pixel-orange': '#ffb86c',
        'pixel-purple': '#bd93f9',
        'pixel-red': '#ff5555',
        'pixel-yellow': '#f1fa8c',
        // Dark shell
        'jarvis-bg': '#0a0a0f',
        'jarvis-surface': '#12121a',
        'jarvis-border': '#1e1e2e',
        'jarvis-accent': '#50fa7b',
        'jarvis-text': '#e2e8f0',
        'jarvis-muted': '#64748b',
      },
      fontFamily: {
        pixel: ['"Press Start 2P"', 'monospace'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
