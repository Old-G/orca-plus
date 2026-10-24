// Custom build (hq-plus-phone): HQ+'s desktop look on the phone — the tokens at the top of the
// desktop's hq-plus.css, so one HQ+ reads the same on both. Web-only CSS (gradients, the grid, the
// slide transitions) sits in plain objects: React Native's style types lack them, react-native-web
// passes them through.
import { StyleSheet } from 'react-native'

export const hqp = {
  bg: '#050a10',
  bg2: '#08131c',
  card: '#0b1823',
  sheet: '#0d1b26',
  soft: 'rgba(143, 233, 255, 0.05)',
  soft2: 'rgba(143, 233, 255, 0.09)',
  line: 'rgba(143, 233, 255, 0.14)',
  line2: 'rgba(143, 233, 255, 0.38)',
  ice: '#8fe9ff',
  ink: '#04131b',
  fg: '#eaf7fb',
  mute: '#a3c1cc',
  faint: '#7e9ca8',
  amber: '#ffc35a',
  amberInk: '#1c1200',
  red: '#ff6b62',
  rose: '#ffb3ad',
  green: '#5fe0a0',
  violet: '#b9a2ff',
  yellow: '#f2e15c',
  slack: '#e7a3ff',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace'
} as const

/** The smallest a finger hits reliably (Apple HIG). */
export const HQP_TOUCH = 44

const grid =
  'linear-gradient(rgba(143,233,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(143,233,255,.04) 1px, transparent 1px)'

export const hqpWeb = {
  grid: { backgroundColor: hqp.bg, backgroundImage: grid, backgroundSize: '44px 44px' },
  edge: {
    backgroundImage: `linear-gradient(${hqp.card}, ${hqp.card}), linear-gradient(135deg, rgba(143,233,255,.55), rgba(185,162,255,.3) 45%, rgba(143,233,255,.08))`,
    backgroundOrigin: 'border-box',
    backgroundClip: 'padding-box, border-box',
    borderColor: 'transparent'
  },
  edgeMove: {
    backgroundImage:
      'linear-gradient(180deg, #132232, #0c1924), linear-gradient(135deg, rgba(255,195,90,.85), rgba(255,195,90,.25) 50%, rgba(143,233,255,.12))',
    backgroundOrigin: 'border-box',
    backgroundClip: 'padding-box, border-box',
    borderColor: 'transparent'
  },
  edgeApprove: {
    backgroundImage:
      'linear-gradient(180deg, #1a1a22, #0c1924), linear-gradient(135deg, rgba(255,107,98,.85), rgba(255,179,173,.3) 50%, rgba(143,233,255,.1))',
    backgroundOrigin: 'border-box',
    backgroundClip: 'padding-box, border-box',
    borderColor: 'transparent'
  },
  slide: {
    opacity: 1,
    transitionProperty: 'transform, opacity',
    transitionDuration: '280ms',
    transitionTimingFunction: 'cubic-bezier(.22,.8,.2,1)'
  },
  noScrollbar: { overflow: 'scroll', scrollbarWidth: 'none' }
} as const

export const hqpStyles = StyleSheet.create({
  label: {
    fontFamily: hqp.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: hqp.faint
  },
  button: {
    minHeight: HQP_TOUCH,
    borderRadius: 12,
    backgroundColor: hqp.soft2,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    flexBasis: '40%'
  },
  buttonMain: { backgroundColor: hqp.ice, flexBasis: '100%' },
  buttonGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: hqp.line },
  buttonLabel: { color: hqp.fg, fontSize: 14, fontWeight: '500', textAlign: 'center' },
  buttonLabelMain: { color: hqp.ink, fontWeight: '600' },
  buttonLabelGhost: { color: hqp.mute },
  pressed: { opacity: 0.6 },
  hint: { fontSize: 12, color: hqp.faint, lineHeight: 17 },
  error: { fontSize: 12.5, color: hqp.rose, lineHeight: 17 },
  pill: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: hqp.line,
    justifyContent: 'center'
  },
  pillLabel: { color: hqp.mute, fontSize: 12.5, fontWeight: '500' },
  link: { color: hqp.ice, fontSize: 13, fontWeight: '500', paddingVertical: 6 }
})
