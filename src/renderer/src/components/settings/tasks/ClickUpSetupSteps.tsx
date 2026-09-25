import { useState } from 'react'
import { ClickUpConnectDialog } from '@/components/clickup-connect-dialog'
import { Button } from '@/components/ui/button'
import { TaskSourceShowInTasksStep } from './TaskSourceShowInTasksStep'
import { TaskSourceStepRow } from './TaskSourceStepRow'
import { translate } from '@/i18n/i18n'

type ClickUpSetupStepsProps = {
  connected: boolean
  checking: boolean
  visible: boolean
  canHide: boolean
  onToggleVisible: () => void
  onOpenIntegrations: () => void
}

export function ClickUpSetupSteps(props: ClickUpSetupStepsProps): React.JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false)
  const connectState = props.checking ? 'in-progress' : props.connected ? 'done' : 'pending'

  return (
    <>
      <ol className="divide-y divide-border/50">
        <TaskSourceStepRow
          index={1}
          state={connectState}
          title={translate(
            'auto.components.settings.ClickUpSetupSteps.connectTitle',
            'Connect ClickUp'
          )}
          description={translate(
            'auto.components.settings.ClickUpSetupSteps.connectDescription',
            'Add a personal API token from ClickUp Settings → Apps.'
          )}
          action={
            <Button
              type="button"
              size="sm"
              variant={props.connected ? 'outline' : 'default'}
              onClick={props.connected ? props.onOpenIntegrations : () => setDialogOpen(true)}
            >
              {props.connected
                ? translate('auto.components.settings.ClickUpSetupSteps.manage', 'Manage token')
                : translate('auto.components.settings.ClickUpSetupSteps.add', 'Add ClickUp access')}
            </Button>
          }
        />
        <TaskSourceShowInTasksStep
          index={2}
          providerLabel={translate('auto.components.settings.TasksPane.clickUpLabel', 'ClickUp')}
          visible={props.visible}
          canHide={props.canHide}
          onToggleVisible={props.onToggleVisible}
        />
      </ol>
      <ClickUpConnectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
