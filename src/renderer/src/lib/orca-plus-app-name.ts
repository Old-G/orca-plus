import { ORCA_PLUS_APP_NAME } from '../../../shared/orca-plus-app-name'

// Custom build (orca-plus-name): a production build shows "Orca+"; dev and vitest keep upstream's text.
export function orcaPlusAppName(stockName: string): string {
  return import.meta.env.PROD ? ORCA_PLUS_APP_NAME : stockName
}
