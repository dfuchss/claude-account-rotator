import type { Elements, RenderSurface } from 'claude-code'

import type { Account, View } from '../types'
import {
  LEAVE_FIVE_HOUR,
  LEAVE_SEVEN_DAY,
  SIGN_IN_WARN_MS,
  availableNow,
  longBar,
  nextReset,
  pie,
  roomLeft,
  tone,
  untilText,
  weekColor,
  windowPct,
} from './model'

export type Ui = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button'>

export type Actions = {
  togglePane: () => void
  signInAll: () => void
  signInOne: (id: string) => void
  cancelSignIn: () => void
  add: () => void
  use: (id: string) => void
  askRemove: (id: string) => void
  remove: (id: string) => void
}

const needsSignIn = (view: View) => view.accounts.filter(a => view.health[a.id]?.kind === 'login-needed')

/**
 * One login in the footer, or what it needs: a pie of what it can serve right
 * now, colored by the room left in its week (a plan that reports no weekly
 * limit has all of it). The login in use is bright and adds its percent.
 */
function loginPie({ Text }: Ui, view: View, a: Account, now: number) {
  const health = view.health[a.id]?.kind
  if (health === 'login-needed') return <Text color="error">⚠</Text>
  if (health === 'logging-in') return <Text color="warning">◌</Text>
  const r = view.readings[a.id]
  const left = availableNow(r, now)
  if (r === undefined || left === undefined) return <Text dimColor>·</Text>
  const isActive = a.id === view.activeId
  return (
    <Text color={weekColor(roomLeft(r.sevenDay, now) ?? 100)} dimColor={!isActive}>
      {isActive ? `${pie(left)}${left}%` : pie(left)}
    </Text>
  )
}

/**
 * The footer, right of the prompt: the engine's mode labels, then every login
 * as one control that opens the pane, or closes it while it shows.
 */
export function Footer(ui: Ui, view: View, modes: readonly string[], now: number, act: Actions) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="row" columnGap={1}>
      {modes.length > 0 && <Text dimColor>{modes.join(' & ')}</Text>}
      <Button key="accounts" label="Claude accounts" plain onPress={act.togglePane}>
        {view.accounts.flatMap((a, i) => (i > 0 ? [' ', loginPie(ui, view, a, now)] : [loginPie(ui, view, a, now)]))}
      </Button>
    </Box>
  )
}

/** The band above the prompt, drawn only while a login needs the person. */
export function Band(ui: Ui, view: View, now: number, act: Actions) {
  const { Box, Text, Button } = ui
  const signingIn = view.accounts.find(a => view.health[a.id]?.kind === 'logging-in')
  if (signingIn !== undefined) {
    return (
      <Box flexDirection="row" columnGap={2}>
        <Text color="warning">
          ◌ Login {signingIn.id}: in your browser, approve as {signingIn.email ?? 'the account to add'} and pick the
          organization. Wrong account there? Sign out of claude.ai in another tab, then reload the sign-in page.
        </Text>
        <Button key="cancel-sign-in" onPress={act.cancelSignIn}>Cancel</Button>
      </Box>
    )
  }
  const locked = needsSignIn(view)
  if (locked.length > 0) {
    const names = locked.map(a => (a.email ? `${a.id} (${a.email})` : a.id)).join(', ')
    const why = locked.map(a => view.health[a.id]).find(h => h?.kind === 'login-needed')
    return (
      <Box flexDirection="row" columnGap={2}>
        <Text color="error">
          ⚠ Claude login {names} needs a sign-in{why?.kind === 'login-needed' ? ` (${why.why})` : ''}.
        </Text>
        <Button key="sign-in-all" variant="primary" hotkey="s" onPress={act.signInAll}>
          {locked.length > 1 ? 'Sign in all' : 'Sign in'}
        </Button>
      </Box>
    )
  }
  const spent = view.accounts.every(a => {
    const r = view.readings[a.id]
    return (windowPct(r?.fiveHour, now) ?? 0) >= LEAVE_FIVE_HOUR || (windowPct(r?.sevenDay, now) ?? 0) >= LEAVE_SEVEN_DAY
  })
  if (view.accounts.length > 0 && spent) {
    const at = nextReset(view, now)
    return (
      <Text color="warning">
        Every Claude login is near its limit{at === undefined ? '' : `; the next frees up ${untilText(at, now)}`}.
      </Text>
    )
  }
  return undefined
}

/** One usage window of a login; a plan that reports no such window (a Team seat's week) says so. */
function windowRow(ui: Ui, name: string, hasReading: boolean, pct: number | undefined, leaveAt: number, resetsAt: string | undefined, now: number) {
  const { Text } = ui
  return (
    <Text>
      {'   '}
      <Text dimColor>{name} </Text>
      <Text color={tone(pct, leaveAt)}>{longBar(pct)}</Text>
      {pct === undefined ? <Text dimColor>{hasReading ? ' none reported' : ' no reading yet'}</Text> : ` ${Math.round(pct)}%`}
      {resetsAt !== undefined && pct !== undefined && pct > 0 && <Text dimColor>  resets {untilText(resetsAt, now)}</Text>}
    </Text>
  )
}

function accountRows(ui: Ui, view: View, a: Account, now: number, act: Actions) {
  const { Box, Text, Button } = ui
  const health = view.health[a.id]
  const r = view.readings[a.id]
  const isActive = a.id === view.activeId
  const status =
    health?.kind === 'login-needed'
      ? <Text color="error">⚠ {health.why}</Text>
      : health?.kind === 'logging-in'
        ? <Text color="warning">◌ signing in…</Text>
        : isActive
          ? <Text color="claude">● in use{view.pending?.id === a.id ? ' (switching…)' : ''}</Text>
          : <Text dimColor>○ standing by</Text>
  const expiry = health?.kind === 'ok' ? health.refreshExpiresAt : undefined
  return (
    <Box key={`account-${a.id}`} flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" columnGap={2}>
        <Text bold>{a.id}</Text>
        <Text>{a.email ?? (a.slot === '' ? 'your normal login' : 'not signed in yet')}</Text>
        {a.orgName !== undefined && <Text dimColor>{a.orgName}{a.plan ? ` (${a.plan})` : ''}</Text>}
        {status}
        {health?.kind === 'login-needed' && <Button key={`sign-in-${a.id}`} variant="primary" onPress={() => act.signInOne(a.id)}>Sign in</Button>}
        {health?.kind === 'ok' && !isActive && <Button key={`use-${a.id}`} onPress={() => act.use(a.id)}>Use now</Button>}
        {a.slot !== '' && health?.kind !== 'logging-in' && (view.removing === a.id
          ? <Button key={`remove-${a.id}`} onPress={() => act.remove(a.id)}>Press again to remove</Button>
          : <Button key={`ask-remove-${a.id}`} dimColor onPress={() => act.askRemove(a.id)}>Remove</Button>)}
      </Box>
      {windowRow(ui, '5h  ', r !== undefined, windowPct(r?.fiveHour, now), LEAVE_FIVE_HOUR, r?.fiveHour?.resetsAt, now)}
      {windowRow(ui, 'week', r !== undefined, windowPct(r?.sevenDay, now), LEAVE_SEVEN_DAY, r?.sevenDay?.resetsAt, now)}
      {expiry !== undefined && expiry - now < SIGN_IN_WARN_MS && (
        <Text color="warning">   sign-in runs out {untilText(expiry, now)}; signing in again renews it</Text>
      )}
    </Box>
  )
}

/** The pane: every login, its usage, and what can be done with it. */
export function Pane(ui: Ui, view: View, now: number, act: Actions) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column">
      <Text dimColor>
        At {LEAVE_FIVE_HOUR}% of the 5-hour limit or {LEAVE_SEVEN_DAY}% of the weekly one, moves to the login with the most of its 5-hour window left.
      </Text>
      <Text> </Text>
      {view.accounts.map(a => accountRows(ui, view, a, now, act))}
      <Box flexDirection="row" columnGap={2}>
        <Button key="add" onPress={act.add}>+ Add a login</Button>
        {needsSignIn(view).length > 1 && <Button key="pane-sign-in-all" variant="primary" onPress={act.signInAll}>Sign in all</Button>}
      </Box>
      {view.note !== undefined && <Text dimColor>{view.note}</Text>}
    </Box>
  )
}
