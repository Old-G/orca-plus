import { MobileHqPlusScreen } from '../../../src/hq-plus/MobileHqPlusScreen'

/**
 * Custom build (hq-mobile): web sibling for HQ, in `tasks.web.tsx`'s shape — the page renders the
 * screen itself; the native file's shell module throws in a browser.
 * Custom build (hq-plus-phone): the header's HQ+ opens HQ+; the old phone HQ stays in src/hq, and
 * rendering `MobileHqScreen` from '../../../src/hq/MobileHqScreen' here brings it back.
 */
export default function MobileHqRoute() {
  return <MobileHqPlusScreen />
}
