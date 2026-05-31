import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'
import tailwindcssAnimate from 'tailwindcss-animate'

const config: Config = {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: {
            height:
              'var(--radix-accordion-content-height, var(--accordion-panel-height, auto))',
          },
        },
        'accordion-up': {
          from: {
            height:
              'var(--radix-accordion-content-height, var(--accordion-panel-height, auto))',
          },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [
    tailwindcssAnimate,
    plugin(({ addUtilities, addVariant }) => {
      addVariant('data-open', [
        '&[data-state="open"]',
        '&[data-open]:not([data-open="false"])',
      ])
      addVariant('data-closed', [
        '&[data-state="closed"]',
        '&[data-closed]:not([data-closed="false"])',
      ])
      addVariant('data-checked', [
        '&[data-state="checked"]',
        '&[data-checked]:not([data-checked="false"])',
      ])
      addVariant('data-unchecked', [
        '&[data-state="unchecked"]',
        '&[data-unchecked]:not([data-unchecked="false"])',
      ])
      addVariant('data-selected', '&[data-selected="true"]')
      addVariant('data-disabled', [
        '&[data-disabled="true"]',
        '&[data-disabled]:not([data-disabled="false"])',
      ])
      addVariant('data-active', [
        '&[data-state="active"]',
        '&[data-active]:not([data-active="false"])',
      ])
      addVariant('data-horizontal', '&[data-orientation="horizontal"]')
      addVariant('data-vertical', '&[data-orientation="vertical"]')
      addVariant('data-popup-open', [
        '&[data-popup-open]',
        '&[data-popup-open]:not([data-popup-open="false"])',
      ])

      addUtilities({
        '.no-scrollbar': {
          '-ms-overflow-style': 'none',
          'scrollbar-width': 'none',
          '&::-webkit-scrollbar': {
            display: 'none',
          },
        },
      })
    }),
  ],
}

export default config
