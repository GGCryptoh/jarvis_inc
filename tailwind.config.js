/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Serious dashboard palette
        jarvis: {
          bg: '#0a0e17',
          surface: '#111827',
          border: '#1e293b',
          accent: '#10b981',
          'accent-dim': '#065f46',
          text: '#e2e8f0',
          muted: '#64748b',
          danger: '#ef4444',
          warning: '#f59e0b',
        },
        // Surveillance pixel palette
        pixel: {
          bg: '#1a1a2e',
          floor: '#2a2a4a',
          desk: '#8b6914',
          monitor: '#00ff88',
          'monitor-glow': '#00ff8833',
          crt: '#0d1117',
          'crt-border': '#3a3a5a',
          skin: '#ffcc99',
          pink: '#ff6b9d',
          green: '#50fa7b',
          orange: '#ffb86c',
          cyan: '#8be9fd',
          purple: '#bd93f9',
          yellow: '#f1fa8c',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        pixel: ['"Press Start 2P"', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scanline': 'scanline 8s linear infinite',
        'blink': 'blink 1s step-end infinite',
        'typing': 'typing 0.4s steps(2) infinite',
        'bob': 'bob 2s ease-in-out infinite',
        'screen-flicker': 'screen-flicker 0.15s infinite',
      },
      keyframes: {
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        typing: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-1px)' },
        },
        bob: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-3px)' },
        },
        'screen-flicker': {
          '0%': { opacity: '0.97' },
          '50%': { opacity: '1' },
          '100%': { opacity: '0.98' },
        },
      },
    },
  },
  plugins: [],
}
