import { MobileHqScreen } from '../../../src/hq/MobileHqScreen'

/**
 * Custom build (hq-mobile): web sibling for HQ, in `tasks.web.tsx`'s shape — the page renders the
 * screen itself; the native file's shell module throws in a browser.
 */
export default function MobileHqRoute() {
  return <MobileHqScreen />
}
