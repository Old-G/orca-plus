// Custom build (hq-plus-round6): the words on a button that opens where something came from.
import { hqSourceService } from '../../../../../shared/hq-source-link'
import { translate } from '@/i18n/i18n'

export function hqPlusSourceLabel(url: string): string {
  switch (hqSourceService(url)) {
    case 'slack':
      return translate('auto.hqPlus.source.slack', 'Open in Slack')
    case 'clickup':
      return translate('auto.hqPlus.source.clickup', 'Open in ClickUp')
    case 'gmail':
      return translate('auto.hqPlus.source.gmail', 'Open in Gmail')
    case 'gitlab':
      return translate('auto.hqPlus.source.gitlab', 'Open in GitLab')
    case null:
      return translate('auto.hqPlus.source.other', 'Open external site')
  }
}
