import { ORCA_PLUS_APP_NAME } from '../../shared/orca-plus-app-name'

// Custom build (orca-plus-name): menu, About panel and window title of a packaged build.
// Why not under vitest: upstream tests pin the stock packaged name.
export const PACKAGED_APP_NAME = import.meta.env.MODE !== 'test' ? ORCA_PLUS_APP_NAME : 'Orca'

// Why not under vitest: upstream tests pin the stock classic icon path.
export const USES_ORCA_PLUS_ICON = import.meta.env.MODE !== 'test'
