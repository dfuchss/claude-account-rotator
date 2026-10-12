import type { Elements, RenderChildren, RenderSurface } from 'claude-code'

import type { Account, Fill, FooterRun, FooterStyle, Glyphs, Highlight, UsageWindow, View } from '../types'
import {
  GLYPHS,
  LEAVE_FIVE_HOUR,
  LEAVE_SEVEN_DAY,
  SIGN_IN_WARN_MS,
  availableNow,
  glyph,
  longBar,
  nextReset,
  roomColor,
  roomLeft,
  shown,
  untilText,
  windowPct,
} from './model'

export type Ui = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button'>

export type Actions = {
  togglePane: () => void
  rotate: () => void
  signInAll: () => void
  signInOne: (id: string) => void
  cancelSignIn: () => void
  add: () => void
  use: (id: string) => void
  askRemove: (id: string) => void
  remove: (id: string) => void
  setFooter: (change: Partial<FooterStyle>) => void
  setDemo: (on: boolean) => void
}

const needsSignIn = (view: View) => view.accounts.filter(a => view.health[a.id]?.kind === 'login-needed')

/** Imitated room left per login, [right now, week], for the pane's demo preview: every color shows. */
const DEMO: readonly (readonly [number, number])[] = [[85, 70], [60, 40], [35, 90], [15, 20], [95, 55]]

/** A login's room left right now and in its week, or the demo's; undefined where it has none. */
function rooms(view: View, a: Account, i: number, now: number): readonly [number | undefined, number | undefined] {
  if (view.demo) return DEMO[i % DEMO.length] ?? [undefined, undefined]
  const r = view.readings[a.id]
  return [availableNow(r, now), roomLeft(r?.sevenDay, now)]
}

/** A percent's room color, lighter while the pointer is over the footer. */
const roomRun = (leftPct: number) => ({ color: roomColor(leftPct), lit: roomColor(leftPct, true) })

/**
 * A login's glyph in a footer row, green with all of its room left to red with
 * none. The session row says when a login needs a sign-in; a login without the
 * room (a plan with no weekly limit) leaves its place blank.
 */
function glyphOf(view: View, a: Account, style: Glyphs, row: 0 | 1, room: number | undefined): FooterRun {
  const health = view.health[a.id]?.kind
  if (health === 'login-needed') return row === 0 ? { text: '⚠', color: 'error' } : { text: ' ' }
  if (health === 'logging-in') return row === 0 ? { text: '◌', color: 'warning' } : { text: ' ' }
  if (room === undefined) return { text: row === 0 ? '·' : ' ' }
  return { text: glyph(style, shown(view.footer.fill, room)), ...roomRun(room) }
}

/** The tile's color: the theme's own shade behind a message the person sent. */
const TILE = 'userMessageBackground'
/** The lines' color: the theme's dim gray, so they frame the column without outshining it; its lighter gray under the pointer. */
const LINE = { color: 'subtle', lit: 'inactive' }

/** How a login's glyph shows it is the one in use, as the pane's setting picks. */
function marked(highlight: Highlight, isActive: boolean): Partial<FooterRun> {
  switch (highlight) {
    case 'tile':
      return isActive ? { backgroundColor: TILE } : {}
    case 'dim':
      return isActive ? {} : { dimColor: true }
    case 'lines':
      return {}
  }
}

/** The highlights that keep a cell at each end of the columns, in every row. */
const HAS_ENDS: readonly Highlight[] = ['lines', 'tile']

/** A row's room left for the login in use, or undefined where it has none. */
function activeRoom(view: View, now: number, row: 0 | 1): number | undefined {
  const i = view.accounts.findIndex(a => a.id === view.activeId)
  const active = view.accounts[i]
  return active === undefined ? undefined : rooms(view, active, i, now)[row]
}

/**
 * The cell before column `i`, or after the last one at `i` = the number of
 * logins: a space between columns, nothing at the ends, unless the lines are
 * drawn there. They stand mid-cell either side of the column in use, half a
 * cell clear of its glyphs.
 */
function edge(view: View, i: number, isLines: boolean): FooterRun[] {
  if (!isLines) return i > 0 && i < view.accounts.length ? [{ text: ' ' }] : []
  const active = view.accounts.findIndex(a => a.id === view.activeId)
  return [i === active || i - 1 === active ? { text: '│', ...LINE } : { text: ' ' }]
}

/**
 * A column as the tile draws it: its glyph with a cell of its own either side,
 * all three on the tile's shade for the login in use. Whole cells only: a
 * terminal that draws a half block from its font can draw it short of the
 * line's height, which notches the shade.
 */
function tiled(glyph: FooterRun, isActive: boolean): FooterRun[] {
  const pad: FooterRun = isActive ? { text: ' ', backgroundColor: TILE } : { text: ' ' }
  return [pad, glyph, pad]
}

/**
 * One footer row as runs of text: a glyph per login, a space apart, then the
 * login in use's percent at the right end. While another row draws glyphs, a
 * row with its own off keeps their columns blank, so its percent lines up
 * under the other's.
 */
function footerRow(view: View, now: number, row: 0 | 1, style: Glyphs, showPercent: boolean, hasColumns: boolean): FooterRun[] {
  const pct = activeRoom(view, now, row)
  const highlight = view.footer.active
  const isLines = hasColumns && highlight === 'lines'
  const glyphAt = (a: Account, i: number): FooterRun => ({
    ...(style === 'none' ? { text: ' ' } : glyphOf(view, a, style, row, rooms(view, a, i, now)[row])),
    ...marked(highlight, a.id === view.activeId),
  })
  const columns = !hasColumns
    ? []
    : highlight === 'tile'
      ? view.accounts.flatMap((a, i) => tiled(glyphAt(a, i), a.id === view.activeId))
      : [...view.accounts.flatMap((a, i) => [...edge(view, i, isLines), glyphAt(a, i)]), ...edge(view, view.accounts.length, isLines)]
  if (!showPercent) return columns
  const gap = hasColumns ? (HAS_ENDS.includes(highlight) ? ' ' : '  ') : ''
  const text = `${gap}${(pct === undefined ? '' : `${shown(view.footer.fill, pct)}%`).padStart(4)}`
  return [...columns, { text, ...(pct === undefined ? {} : roomRun(pct)) }]
}

/** The shade the footer's glyphs stand on under the pointer: the theme's own behind a message the person sent. */
const HOVER_SHADE = 'userMessageBackground'

const widthOf = (row: readonly FooterRun[]) => row.reduce((n, run) => n + run.text.length, 0)

/**
 * The rows' runs as Text, rows a line apart and padded to the widest, so the
 * hover shade is one even block. Under the pointer a Button is drawn inverted,
 * its colors swapped, so each run's hover is given swapped: its lighter color
 * as the background, the shade as the color. Inverted, that is the glyphs lit
 * on the shade.
 */
function runsText({ Text }: Ui, rows: readonly FooterRun[][]) {
  const width = Math.max(...rows.map(widthOf))
  return rows.flatMap((row, i) => [
    ...(i > 0 ? ['\n'] : []),
    <Text>
      {[...row, ...(widthOf(row) < width ? [{ text: ' '.repeat(width - widthOf(row)) }] : [])].map(run => (
        <Text
          color={run.color}
          backgroundColor={run.backgroundColor}
          dimColor={run.dimColor}
          hover={{ color: HOVER_SHADE, backgroundColor: run.lit ?? run.color ?? 'text', dimColor: false }}
        >
          {run.text}
        </Text>
      ))}
    </Text>,
  ])
}

/** What each footer row counts, said left of it while the pointer is over the footer. */
const ROW_NAMES = ['Session:', 'Weekly:'] as const

/**
 * The footer, right of the prompt: the engine's mode labels, then a row per
 * row picked in the pane (right now, the week), glyphs and percent each on or
 * off, as one control that opens the pane, or closes it while it shows. Under
 * the pointer the glyphs light up on a shade, and each row's name shows at its
 * left. A week row with nothing to show is left out; with both rows off, a
 * word keeps the control.
 */
export function Footer(ui: Ui, view: View, modes: readonly string[], now: number, act: Actions) {
  const { Box, Text, Button } = ui
  const { session, week, sessionPercent, weekPercent } = view.footer
  const hasWeek = view.accounts.some((a, i) => rooms(view, a, i, now)[1] !== undefined)
  const sessionGlyphs = session !== 'none'
  const weekGlyphs = week !== 'none' && hasWeek
  const hasColumns = sessionGlyphs || weekGlyphs
  const weekShown = weekGlyphs || (weekPercent && activeRoom(view, now, 1) !== undefined)
  const shownRows = [...(sessionGlyphs || sessionPercent ? [0 as const] : []), ...(weekShown ? [1 as const] : [])]
  const rows = shownRows.map(row =>
    row === 0 ? footerRow(view, now, 0, session, sessionPercent, hasColumns) : footerRow(view, now, 1, week, weekPercent, hasColumns),
  )
  return (
    <Box flexDirection="row" columnGap={1}>
      {modes.length > 0 && <Text dimColor>{modes.join(' & ')}</Text>}
      <Box key="accounts-area" flexDirection="row" columnGap={1}>
        {rows.length > 0 && (
          <Box display="none" hover={{ display: 'flex' }} flexDirection="column" alignItems="flex-end">
            {shownRows.map(row => (
              <Text dimColor>{ROW_NAMES[row]}</Text>
            ))}
          </Box>
        )}
        {/* A scope of its own: the glyphs light only while the pointer is on them, as the control inverts. */}
        <Box key="accounts-glyphs">
          <Button key="accounts" label="Claude accounts" plain onPress={act.togglePane}>
            {rows.length === 0 ? <Text dimColor>accounts</Text> : runsText(ui, rows)}
          </Button>
        </Box>
      </Box>
    </Box>
  )
}

/** The pane's mark for what is in use or picked: the theme's yellow. */
const ACCENT = 'warning'

/** A setting that is on or off, as a press that flips it. */
function toggle(ui: Ui, key: string, label: string, on: boolean, set: (on: boolean) => void) {
  const { Text, Button } = ui
  return (
    <Button key={key} plain onPress={() => set(!on)}>
      <Text color={on ? ACCENT : undefined} dimColor={!on}>
        {on ? '■' : '□'} {label}
      </Text>
    </Button>
  )
}

/** Settings' names take a column of their own; their presses wrap under each other on a narrow pane. */
const NAME_WIDTH = 9

/** One setting: its name, then its options as presses, the picked one marked. */
function choice<T extends string>(
  ui: Ui,
  key: string,
  name: string,
  options: readonly (readonly [T, string])[],
  picked: T,
  pick: (value: T) => void,
) {
  const { Box, Text, Button } = ui
  return (
    <Box key={key} flexDirection="row">
      <Box width={NAME_WIDTH} flexShrink={0}>
        <Text dimColor>{name}</Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {options.map(([value, label]) => (
          <Button key={`${key}-${value}`} plain onPress={() => pick(value)}>
            <Text color={value === picked ? ACCENT : undefined} dimColor={value !== picked}>
              {value === picked ? '●' : '○'} {label}
            </Text>
          </Button>
        ))}
      </Box>
    </Box>
  )
}

const GLYPH_CHOICES = GLYPHS.map(g => [g, g] as const)
const HIGHLIGHT_CHOICES = [
  ['lines', 'lines'],
  ['tile', 'tile'],
  ['dim', 'dim the rest'],
] as const
const FILL_CHOICES = [
  ['left', 'room left'],
  ['used', 'used'],
] as const satisfies readonly (readonly [Fill, string])[]
const PREVIEW_CHOICES = [
  ['real', 'your usage'],
  ['demo', 'demo values'],
] as const

/**
 * A group of the pane in a box of its own, its name set in the top border: the
 * name is painted over the border as the wrapper's last child.
 */
function section(ui: Ui, key: string, title: string, children: RenderChildren) {
  const { Box, Text } = ui
  return (
    <Box key={key} flexDirection="column">
      <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
        {children}
      </Box>
      <Box position="absolute" top={0} left={2}>
        <Text bold> {title} </Text>
      </Box>
    </Box>
  )
}

/** The footer's settings: a style and a percent per row, what glyphs fill with, how the login in use stands out, and a demo preview. */
function FooterSettings(ui: Ui, view: View, act: Actions) {
  const { Box, Text } = ui
  return section(ui, 'display', 'Display', [
    choice(ui, 'footer-session', 'Session', GLYPH_CHOICES, view.footer.session, session => act.setFooter({ session })),
    choice(ui, 'footer-week', 'Week', GLYPH_CHOICES, view.footer.week, week => act.setFooter({ week })),
    <Box key="footer-percent" flexDirection="row">
      <Box width={NAME_WIDTH} flexShrink={0}>
        <Text dimColor>Percent</Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {toggle(ui, 'footer-percent-session', 'session', view.footer.sessionPercent, on => act.setFooter({ sessionPercent: on }))}
        {toggle(ui, 'footer-percent-week', 'week', view.footer.weekPercent, on => act.setFooter({ weekPercent: on }))}
      </Box>
    </Box>,
    choice(ui, 'footer-fill', 'Show', FILL_CHOICES, view.footer.fill, fill => act.setFooter({ fill })),
    choice(ui, 'footer-active', 'In use', HIGHLIGHT_CHOICES, view.footer.active, active => act.setFooter({ active })),
    choice(ui, 'footer-preview', 'Preview', PREVIEW_CHOICES, view.demo ? 'demo' : 'real', v => act.setDemo(v === 'demo')),
  ])
}

/** The band above the prompt, drawn only while a login needs the person. */
export function Band(ui: Ui, view: View, now: number, act: Actions) {
  const { Box, Text, Button } = ui
  const signingIn = view.accounts.find(a => view.health[a.id]?.kind === 'logging-in')
  if (signingIn !== undefined) {
    return (
      <Box flexDirection="row" columnGap={2}>
        <Text color="warning">
          ◌ Account {signingIn.id}: in your browser, approve as {signingIn.email ?? 'the account to add'} and pick the
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
          ⚠ Claude account {names} needs a sign-in{why?.kind === 'login-needed' ? ` (${why.why})` : ''}.
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
        Every Claude account is near its limit{at === undefined ? '' : `; the next frees up ${untilText(at, now)}`}.
      </Text>
    )
  }
  return undefined
}

/** A window's bar and percent at their widest ("▰▰▰▰▰▰▰▰▰▰ 100% left"), so the reset times line up. */
const BAR_WIDTH = 20

/**
 * One usage window of a login, filled and colored as the footer draws it, and
 * when it resets: beside it, or under the bar on a narrow pane. A plan that
 * reports no such window (a Team seat's week) says so.
 */
function windowRow(ui: Ui, fill: Fill, isActive: boolean, name: string, hasReading: boolean, w: UsageWindow | undefined, now: number) {
  const { Box, Text } = ui
  const left = roomLeft(w, now)
  return (
    <Box flexDirection="row" marginLeft={3}>
      <Box width={5} flexShrink={0}>
        <Text dimColor={!isActive}>{name}</Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Box minWidth={BAR_WIDTH}>
          {left === undefined ? (
            <Text dimColor>
              {longBar(undefined)}
              {hasReading ? ' none reported' : ' no reading yet'}
            </Text>
          ) : (
            <Text color={roomColor(left)}>{`${longBar(shown(fill, left))} ${shown(fill, left)}% ${fill === 'left' ? 'left' : 'used'}`}</Text>
          )}
        </Box>
        {w?.resetsAt !== undefined && left !== undefined && left < 100 && <Text dimColor={!isActive}>resets {untilText(w.resetsAt, now)}</Text>}
      </Box>
    </Box>
  )
}

/** The slot at the right end of a login's line: as wide as a button the terminal draws, `[ Use now ]`, so the Removes beside it line up. */
const USE_WIDTH = '[ Use now ]'.length

/**
 * The right end of a login's line: what it needs, then Remove, then rightmost
 * always its use, in a slot of its own: in use, Use now, Sign in while it
 * needs one, or signing in.
 */
function lineEnd(ui: Ui, view: View, a: Account, act: Actions) {
  const { Box, Text, Button } = ui
  const health = view.health[a.id]
  const remove =
    a.slot !== '' &&
    health?.kind !== 'logging-in' &&
    (view.removing === a.id ? (
      <Button key={`remove-${a.id}`} onPress={() => act.remove(a.id)}>Press again to remove</Button>
    ) : (
      <Button key={`ask-remove-${a.id}`} dimColor onPress={() => act.askRemove(a.id)}>Remove</Button>
    ))
  const use = (end: RenderChildren) => (
    <Box minWidth={USE_WIDTH} justifyContent="flex-end">
      {end}
    </Box>
  )
  switch (health?.kind) {
    case 'login-needed':
      return [
        <Text color="error">⚠ {health.why}</Text>,
        remove,
        use(<Button key={`sign-in-${a.id}`} variant="primary" onPress={() => act.signInOne(a.id)}>Sign in</Button>),
      ]
    case 'logging-in':
      return [use(<Text color="warning">◌ signing in…</Text>)]
    default:
      return [
        remove,
        use(
          a.id === view.activeId ? (
            <Text color={ACCENT}>● in use</Text>
          ) : (
            health?.kind === 'ok' && <Button key={`use-${a.id}`} onPress={() => act.use(a.id)}>Use now</Button>
          ),
        ),
      ]
  }
}

/**
 * One login: who it is at the left of its first line, its state and presses
 * at the right (under it, still at the right, on a pane too narrow for both),
 * then its two windows. The login in use is drawn bright, the rest dim.
 */
function accountRows(ui: Ui, view: View, a: Account, now: number, act: Actions) {
  const { Box, Text } = ui
  const health = view.health[a.id]
  const r = view.readings[a.id]
  const isActive = a.id === view.activeId
  const expiry = health?.kind === 'ok' ? health.refreshExpiresAt : undefined
  return (
    <Box key={`account-${a.id}`} flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Box flexDirection="row" flexShrink={1}>
          <Box width={3} flexShrink={0}>
            <Text bold={isActive} dimColor={!isActive}>{a.id}</Text>
          </Box>
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            <Text bold={isActive} dimColor={!isActive}>{a.email ?? (a.slot === '' ? 'your normal account' : 'not signed in yet')}</Text>
            {a.orgName !== undefined && <Text dimColor>{a.orgName}{a.plan ? ` · ${a.plan}` : ''}</Text>}
          </Box>
        </Box>
        <Box flexDirection="row" flexGrow={1} flexWrap="wrap" justifyContent="flex-end" columnGap={2}>
          {lineEnd(ui, view, a, act)}
        </Box>
      </Box>
      {windowRow(ui, view.footer.fill, isActive, '5h', r !== undefined, r?.fiveHour, now)}
      {windowRow(ui, view.footer.fill, isActive, 'week', r !== undefined, r?.sevenDay, now)}
      {expiry !== undefined && expiry - now < SIGN_IN_WARN_MS && (
        <Text color="warning">   sign-in runs out {untilText(expiry, now)}; signing in again renews it</Text>
      )}
    </Box>
  )
}

/** When the rotation moves on, counted the way the footer shows it: room left, or what is used. */
function rule(fill: Fill): string {
  const when =
    fill === 'left'
      ? `Once the account in use has ${100 - LEAVE_FIVE_HOUR}% of its 5-hour window or ${100 - LEAVE_SEVEN_DAY}% of its week left`
      : `Once the account in use has used ${LEAVE_FIVE_HOUR}% of its 5-hour window or ${LEAVE_SEVEN_DAY}% of its week`
  return `${when}, moves to the account with the most room right now.`
}

/**
 * The pane: when the rotation moves on, then every account, its usage and what
 * can be done with it, then the footer's settings, each group in its box.
 */
export function Pane(ui: Ui, view: View, now: number, act: Actions) {
  const { Box, Text, Button } = ui
  const accounts = [
    ...view.accounts.map(a => accountRows(ui, view, a, now, act)),
    <Box key="add-row" flexDirection="row" columnGap={2}>
      <Button key="add" onPress={act.add}>+ Add an account</Button>
      {view.accounts.length > 1 && <Button key="rotate" onPress={act.rotate}>Rotate now</Button>}
      {needsSignIn(view).length > 1 && <Button key="pane-sign-in-all" variant="primary" onPress={act.signInAll}>Sign in all</Button>}
    </Box>,
  ]
  return (
    <Box flexDirection="column" rowGap={1}>
      <Text dimColor>{rule(view.footer.fill)}</Text>
      {section(ui, 'accounts', 'Accounts', accounts)}
      {FooterSettings(ui, view, act)}
    </Box>
  )
}
