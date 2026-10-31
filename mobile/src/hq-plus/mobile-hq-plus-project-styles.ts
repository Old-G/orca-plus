// Custom build (hq-project-cards): the phone's project card styles, shared by the card and its rows.
import { StyleSheet } from 'react-native'
import { HQP_TOUCH, hqp } from './hq-plus-phone-theme'

export const hqpProjectStyles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: hqp.line,
    backgroundColor: hqp.card,
    paddingBottom: 6
  },
  compact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: HQP_TOUCH
  },
  compactTitle: { color: hqp.fg, fontSize: 14.5, fontWeight: '600', flexShrink: 1 },
  compactSum: { flexBasis: '100%', paddingHorizontal: 0 },
  head: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
    paddingHorizontal: 12,
    paddingBottom: 4
  },
  pdot: { width: 9, height: 9, borderRadius: 5 },
  title: { color: hqp.fg, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  room: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 10.5, letterSpacing: 1 },
  tm: { marginLeft: 'auto', color: hqp.faint, fontFamily: hqp.mono, fontSize: 11 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingTop: 4 },
  pill: {
    height: 22,
    lineHeight: 20,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: hqp.line,
    color: hqp.mute,
    fontFamily: hqp.mono,
    fontSize: 11,
    overflow: 'hidden'
  },
  pillYou: {
    borderColor: 'rgba(255,195,90,.5)',
    backgroundColor: 'rgba(255,195,90,.08)',
    color: hqp.amber
  },
  pickWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 12,
    paddingBottom: 6
  },
  pickPill: {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: hqp.line,
    justifyContent: 'center'
  },
  pickText: { color: hqp.mute, fontFamily: hqp.mono, fontSize: 11.5 },
  pickError: { color: hqp.red, fontSize: 12, width: '100%' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 12, paddingBottom: 8 },
  action: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: hqp.line,
    backgroundColor: hqp.soft,
    justifyContent: 'center'
  },
  actionMain: { backgroundColor: hqp.ice, borderColor: hqp.ice },
  actionText: { color: hqp.fg, fontSize: 13, fontWeight: '500' },
  sec: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    paddingTop: 8,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: hqp.line
  },
  secLabel: { fontSize: 10.5 },
  fold: { marginLeft: 'auto', minHeight: 32, justifyContent: 'center' },
  foldText: { color: hqp.ice, fontSize: 13, fontWeight: '500' },
  summary: { paddingHorizontal: 12, paddingVertical: 8, minHeight: 36 },
  summaryText: { color: hqp.mute, fontSize: 13, lineHeight: 19 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minHeight: HQP_TOUCH,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginHorizontal: 4,
    borderRadius: 10
  },
  rowOpen: { backgroundColor: hqp.soft2 },
  flash: { boxShadow: '0 0 0 3px rgba(255,195,90,.35)' },
  grow: { flex: 1, minWidth: 0 },
  rowTitle: { color: hqp.mute, fontSize: 13.5, lineHeight: 19 },
  who: { color: hqp.fg, fontWeight: '600' },
  holder: { color: hqp.ice, fontFamily: hqp.mono, fontSize: 10.5 },
  age: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 11 },
  open: { paddingHorizontal: 6, paddingTop: 4, paddingBottom: 8 },
  waits: { gap: 6, paddingLeft: 40, paddingRight: 10, paddingBottom: 8 },
  wait: {
    gap: 3,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: hqp.soft,
    borderWidth: 1,
    borderColor: hqp.line
  },
  waitText: { color: hqp.fg, fontSize: 13, lineHeight: 18 },
  waitWhen: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 10.5 },
  todayRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 4 },
  tt: { width: 40, color: hqp.faint, fontFamily: hqp.mono, fontSize: 11, lineHeight: 19 },
  todayText: { color: hqp.mute, fontSize: 13, lineHeight: 19 },
  chatLine: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  x: {
    width: HQP_TOUCH,
    height: HQP_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10
  },
  xText: { color: hqp.faint, fontSize: 20 },
  ask: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 6
  },
  askText: { color: hqp.mute, fontSize: 12.5, flex: 1 },
  askBtn: { minHeight: 32, justifyContent: 'center' },
  askClose: { color: hqp.rose, fontSize: 13, fontWeight: '600' }
})
