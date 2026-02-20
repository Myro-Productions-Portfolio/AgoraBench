import type { Config } from 'tailwindcss';
import forms from '@tailwindcss/forms';
import typography from '@tailwindcss/typography';

const config: Config = {
  content: ['./index.html', './src/core/client/**/*.{ts,tsx}', './src/modules/*/client/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /* Dark mode palette (primary) */
        capitol: {
          deep: '#1A1B1E',
          bg: '#2B2D31',
          surface: '#35373C',
          card: '#36393F',
          elevated: '#3E4147',
        },
        gold: {
          DEFAULT: '#B8956A',
          bright: '#D4A96A',
          muted: '#A07E5A',
          dark: '#8A6A48',
        },
        stone: {
          DEFAULT: '#C9B99B',
          light: '#D4C9B0',
          muted: '#9B8F7A',
        },
        slate: {
          judicial: '#6B7A8D',
          light: '#8B9DB5',
        },
        /* Status colors */
        status: {
          passed: '#4CAF50',
          'passed-bg': 'rgba(58, 107, 58, 0.2)',
          'passed-text': '#6BAF6B',
          failed: '#F44336',
          'failed-bg': 'rgba(139, 58, 58, 0.15)',
          committee: '#FF9800',
          'committee-bg': 'rgba(107, 122, 141, 0.2)',
          'committee-text': '#8B9DB5',
          active: '#43B581',
        },
        /* Text colors */
        text: {
          primary: '#E8E6E3',
          secondary: '#A0A0A0',
          muted: '#72767D',
        },
        /* Borders */
        border: {
          DEFAULT: '#4E5058',
          light: 'rgba(78, 80, 88, 0.5)',
          lighter: 'rgba(78, 80, 88, 0.3)',
        },
        /* Light mode palette */
        light: {
          bg: '#F5F3F0',
          surface: '#FFFFFF',
          blue: '#1C3D5A',
          gold: '#8B6F47',
        },
        /* Danger and success */
        danger: {
          DEFAULT: '#8B3A3A',
          bg: 'rgba(139, 58, 58, 0.15)',
          text: '#B07A7A',
        },
        success: {
          DEFAULT: '#3A6B3A',
          bg: 'rgba(58, 107, 58, 0.15)',
        },
      },
      fontFamily: {
        serif: ['Playfair Display', 'Georgia', 'serif'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        'hero-title': ['2.75rem', { lineHeight: '1.2', letterSpacing: '2px' }],
        'section-title': ['1.5rem', { lineHeight: '1.3' }],
        'card-title': ['1.15rem', { lineHeight: '1.4' }],
        'stat-value': ['1.75rem', { lineHeight: '1' }],
        'stat-label': ['0.75rem', { lineHeight: '1', letterSpacing: '1px' }],
        'nav-link': ['0.85rem', { lineHeight: '1', letterSpacing: '0.4px' }],
        badge: ['0.7rem', { lineHeight: '1', letterSpacing: '0.5px' }],
      },
      spacing: {
        'nav-height': '64px',
        'nav-compact': '56px',
        section: '2.5rem',
      },
      borderRadius: {
        card: '6px',
        badge: '3px',
        icon: '8px',
      },
      boxShadow: {
        nav: '0 2px 8px rgba(0, 0, 0, 0.3)',
        'gold-glow': '0 0 12px rgba(184, 149, 106, 0.25)',
        card: '0 1px 3px rgba(0, 0, 0, 0.2)',
      },
      backgroundImage: {
        'nav-gradient': 'linear-gradient(180deg, #3A3D42 0%, #2F3136 100%)',
        'hero-gradient': 'linear-gradient(180deg, #1E1F22 0%, #2B2D31 100%)',
        'gold-btn': 'linear-gradient(180deg, #B8956A 0%, #A07E5A 100%)',
        'gold-btn-hover': 'linear-gradient(180deg, #D4A96A 0%, #B8956A 100%)',
        'election-banner':
          'linear-gradient(135deg, rgba(184, 149, 106, 0.1) 0%, rgba(201, 185, 155, 0.05) 100%)',
      },
      maxWidth: {
        content: '1800px',
      },
      animation: {
        pulse: 'pulse 2s infinite',
        ticker: 'ticker 300s linear infinite',
      },
      keyframes: {
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        ticker: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
    },
  },
  plugins: [forms, typography],
};

export default config;
