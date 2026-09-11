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
        'accent-hover': 'hsl(var(--accent-hover))',
        'accent-selected': 'hsl(var(--accent-selected))',
        'border-subtle': 'hsl(var(--border-subtle))',
        'border-strong': 'hsl(var(--border-strong))',
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          secondary: 'hsl(var(--surface-secondary))',
          elevated: 'hsl(var(--surface-elevated))',
          sunken: 'hsl(var(--surface-sunken))',
        },
        sidebar: 'hsl(var(--sidebar))',
        editor: 'hsl(var(--editor))',
        success: { DEFAULT: 'hsl(var(--success))', bg: 'hsl(var(--success-bg))', foreground: 'hsl(var(--success-foreground))' },
        warning: { DEFAULT: 'hsl(var(--warning))', bg: 'hsl(var(--warning-bg))', foreground: 'hsl(var(--warning-foreground))' },
        danger: { DEFAULT: 'hsl(var(--danger))', bg: 'hsl(var(--danger-bg))', foreground: 'hsl(var(--danger-foreground))' },
        info: { DEFAULT: 'hsl(var(--info))', bg: 'hsl(var(--info-bg))', foreground: 'hsl(var(--info-foreground))' },
        grid: {
          header: 'hsl(var(--grid-header))',
          hover: 'hsl(var(--grid-hover))',
          selected: 'hsl(var(--grid-selected))',
          focus: 'hsl(var(--grid-focus))',
          border: 'hsl(var(--grid-border))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius-lg)',
        md: 'var(--radius)',
        sm: 'var(--radius-sm)',
      },
      fontFamily: {
        sans: [
          'Geist Variable',
          'PingFang SC',
          'Microsoft YaHei UI',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'SFMono-Regular',
          'Cascadia Code',
          'Roboto Mono',
          'Consolas',
          'monospace',
        ],
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
