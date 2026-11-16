// The colours of a BackdropKit theme, as makeColors reads them: Sunfield's two looks, each for
// one mode. A light moment gets the light look, with pale-sky surfaces and deep-blue words; a
// dark moment gets the dark look, with night-sky surfaces and pale words. theme.js says which
// each moment is, and the tint and opacity of the frosted glass over it.
import { THEME } from './theme.js'

const ROLES = { accent: '#1b8ef8', danger: '#d2412f', success: '#4b8a24', warning: '#e89400', pro: '#7a52d1' }

export const COLORS = {
  label: THEME.name,
  only: 'light',
  roles: ROLES,
  light: {
    gray: {
      anchors: {
        'surface-0': '#dbeaf8',
        'surface-1': '#e7f2fc',
        'surface-2': '#f3f9fe',
        'text-primary': '#0c2140',
        'text-secondary': '#1d3656',
        'text-muted': '#2f4566',
      },
    },
  },
}

export const NIGHT_COLORS = {
  label: THEME.name + ' night',
  only: 'dark',
  roles: ROLES,
  dark: {
    gray: {
      anchors: {
        'surface-0': '#111834',
        'surface-1': '#151d3c',
        'surface-2': '#1a2245',
        'surface-3': '#1d264b',
        'text-primary': '#eef1fb',
        'text-secondary': '#d3d8ec',
        'text-muted': '#b5bcd8',
      },
    },
  },
}

// How far the desktop blurs the scene behind its panels.
export const BLUR = 28
