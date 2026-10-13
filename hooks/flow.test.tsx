import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, ProcessRunResult, SessionRateLimit } from 'claude-code'

import { keychainItem, roomColor } from './model'

const NOW = Date.parse('2026-10-12T10:00:00Z')
const HOUR = 3600_000
const SLOT2 = '/Users/tester/.claude/accounts/2'

type World = {
  /** keychain item name -> stored JSON */
  keychain: Record<string, string>
  /** access token -> [5-hour %, week %, or null where the plan reports no weekly limit] */
  usage: Record<string, [number, number | null]>
  /** slot -> signed-in email */
  emails: Record<string, string>
  envSets: { name: string; value?: string }[]
  spawned: { argv: readonly string[]; env?: Record<string, string> }[]
  submitted: string[]
  /** What the session's last response reported, as `$.session.usage()` answers it. */
  limits: SessionRateLimit[]
  /** Ids of the panes open now. */
  panes: string[]
  toasts: string[]
}

const blob = (token: string, expiresAt = NOW + 6 * HOUR) =>
  JSON.stringify({
    claudeAiOauth: {
      accessToken: token,
      refreshToken: `refresh-${token}`,
      expiresAt,
      refreshTokenExpiresAt: NOW + 20 * 24 * HOUR,
      scopes: ['user:inference', 'user:profile'],
      subscriptionType: 'max',
    },
  })

const ran = (exitCode: number, stdout: string): ProcessRunResult => ({
  exitCode,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

/** Everything beneath the plugin: keychain, `claude auth`, the usage API, the UI sinks. */
function world(on: On, w: World, store: Record<string, unknown>): MockClock {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, store)
  mock.env(on, { USER: 'tester', HOME: '/Users/tester' })
  on('env.set', (_$, e) => {
    w.envSets.push(e)
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    const [cmd, sub, verb] = e.argv
    if (cmd === 'security') {
      const stored = w.keychain[e.argv[e.argv.length - 1] ?? '']
      return { value: stored === undefined ? ran(44, '') : ran(0, stored) }
    }
    if (cmd === 'claude' && sub === 'auth' && verb === 'status') {
      const email = w.emails[e.init?.env?.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? '']
      const status = email ? { loggedIn: true, email, orgId: `org-${email}`, orgName: 'Org', subscriptionType: 'max' } : { loggedIn: false }
      return { value: ran(0, JSON.stringify(status)) }
    }
    throw new Error(`unexpected command: ${e.argv.join(' ')}`)
  })
  on('http.fetch', (_$, e) => {
    const token = (e.init?.headers?.Authorization ?? '').replace('Bearer ', '')
    const usage = w.usage[token]
    if (usage === undefined) return { value: { status: 401, ok: false, headers: {}, text: '' } }
    const [five, week] = usage
    const body = {
      five_hour: { utilization: five, resets_at: '2026-10-12T12:00:00Z' },
      seven_day: week === null ? null : { utilization: week, resets_at: '2026-10-18T03:00:00Z' },
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('prompt.submit', (_$, e) => {
    w.submitted.push(e.text)
    return { text: e.text }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: w.limits } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('classic.StopFailure', () => ({}))
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'iterm2' } }))
  on('ui.open', (_$, e) => {
    if (!w.panes.includes(e.id)) w.panes.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: w.panes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.close', (_$, e) => {
    w.panes = w.panes.filter(id => id !== e.id)
    return { value: undefined }
  })
  on('fs.write', () => ({ value: undefined }))
  return clock
}

const fresh = (): World => ({ keychain: {}, usage: {}, emails: {}, envSets: [], spawned: [], submitted: [], limits: [], panes: [], toasts: [] })
const TWO_LOGINS = { accounts: [{ id: '1', slot: '', email: 'one@example.com' }, { id: '2', slot: SLOT2, email: 'two@example.com' }] }

/** The props of every Text drawn with a color or on one, its hover with them, in document order. */
function painted(node: unknown): Record<string, unknown>[] {
  if (typeof node !== 'object' || node === null) return []
  const { type, props, hover, children } = node as { type?: string; props?: Record<string, unknown>; hover?: unknown; children?: unknown[] }
  const isPainted = props?.color !== undefined || props?.backgroundColor !== undefined
  const own = type === 'Text' && isPainted ? [{ ...props, ...(hover === undefined ? {} : { hover }) }] : []
  return [...own, ...(children ?? []).flatMap(painted)]
}

/** The footer's one control: its glyphs, opening the pane. */
const GLYPHS = { key: 'accounts' } as const

const PANE_PROPS = {
  title: 'Claude accounts',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

async function start($: Engine, clock: MockClock): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
}

test('a login with nothing in the keychain shows as needing a sign-in, with one button for it', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({
      plugin: 'account-rotator',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} },
    })
    expect(await band.find({ text: /account 2 \(two@example.com\) needs a sign-in \(not signed in\)/ })).toBeDefined()
    expect(await band.find({ key: 'sign-in-all' })).toBeDefined()
    await band.unmount()
  }
  expect(w.envSets).toEqual([])
})

test('moves to the login with room once the active one passes 90% of its 5-hour window', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [92, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  // Braille of what each login can serve now over bars of its week: login 1 (8% left now)
  // on standby, login 2 (90% left) in use, a line down each side of its column, its percents at the right.
  const button = await footer.find(GLYPHS)
  expect(button?.text).toBe(' ⣀│⣷│  90% \n ▅│▆│  70% ')
  // Every glyph in its room's color, the lines in the theme's dim gray.
  const [one, lineBefore, two, lineAfter, percent] = painted(button?.children[0])
  expect(one).toMatchObject({ color: roomColor(8) })
  expect(lineBefore).toMatchObject({ color: 'subtle' })
  expect(two).toMatchObject({ color: roomColor(90) })
  expect(lineAfter).toMatchObject({ color: 'subtle' })
  expect(percent).toMatchObject({ color: roomColor(90) })
  await footer.unmount()
})

test('the band\'s Sign in signs a locked login in through the browser, in its own slot', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  const item2 = await keychainItem(SLOT2)
  const clock = world(on, w, TWO_LOGINS)
  on('process.spawn', async function* (_$, e) {
    w.spawned.push(e)
    yield { stream: 'stdout' as const, text: 'Opening browser to sign in…\n' }
    w.keychain[item2] = blob('tok-2')
    w.usage['tok-2'] = [5, 12]
    return { value: { code: 0, signal: null } }
  })
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: ['auto mode'] } })
  expect((await footer.find(GLYPHS))?.text).toBe('│⣷│⚠   80% \n│▆│    70% ')
  const band = await $.ui.mount({
    plugin: 'account-rotator',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  })
  await band.press({ key: 'sign-in-all' })
  await clock.settle()
  await band.unmount()
  expect(w.spawned).toEqual([
    {
      argv: ['claude', 'auth', 'login', '--claudeai', '--email', 'two@example.com'],
      env: { CLAUDE_SECURESTORAGE_CONFIG_DIR: SLOT2, CLAUDE_CONFIG_DIR: SLOT2 },
    },
  ])
  await footer.redraw()
  expect((await footer.find(GLYPHS))?.text).toBe('│⣷│⣿   80% \n│▆│▇   70% ')
  expect(await footer.find({ text: /auto mode/ })).toBeDefined()
  await footer.unmount()
})

test('a turn that dies on the usage limit moves to the other login, then asks Claude to carry on', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [60, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.envSets).toEqual([])
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(w.submitted).toEqual([])
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]).toMatch(/Continue where you left off/)
})

test('a switch is confirmed once a response reports the new login usage, and an idle session is not told it failed', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [93, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  // Minutes with no response: the last one is still login 1's, which says nothing of the switch.
  w.limits = [{ kind: 'five_hour', percentUsed: 93, resetsAt: '2026-10-12T12:00:00Z' }]
  await clock.advance(5 * 60_000)
  expect(w.toasts.filter(t => /has not shown/.test(t))).toEqual([])
  w.limits = [
    { kind: 'five_hour', percentUsed: 11, resetsAt: '2026-10-12T12:00:00Z' },
    { kind: 'seven_day', percentUsed: 30, resetsAt: '2026-10-18T03:00:00Z' },
  ]
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  // Confirmed: the next response's usage is login 2's own again.
  w.limits = [
    { kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-12T12:00:00Z' },
    { kind: 'seven_day', percentUsed: 30, resetsAt: '2026-10-18T03:00:00Z' },
  ]
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  // Room left, as the footer counts it: login 2 has used 20% of its 5-hour window and 30% of its week.
  expect(await pane.find({ text: /^▰{8}▱{2} 80% left$/ })).toBeDefined()
  expect(await pane.find({ text: /^▰{7}▱{3} 70% left$/ })).toBeDefined()
  expect(w.toasts.filter(t => /has not shown/.test(t))).toEqual([])
  await pane.unmount()
})

test('one press on the footer opens the accounts pane, the next closes it', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  await footer.press(GLYPHS)
  await clock.settle()
  expect(w.panes).toEqual(['claude-accounts'])
  await footer.press(GLYPHS)
  await clock.settle()
  expect(w.panes).toEqual([])
  await footer.unmount()
})

test('under the pointer the footer names its rows and lights its glyphs on a shade, drawn swapped for the inverting control', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(await footer.find({ text: 'Session:' })).toBeDefined()
  expect(await footer.find({ text: 'Weekly:' })).toBeDefined()
  const [line, one] = painted((await footer.find(GLYPHS))?.children[0])
  expect(line).toMatchObject({ color: 'subtle', hover: { color: 'userMessageBackground', backgroundColor: 'inactive' } })
  expect(one).toMatchObject({ color: roomColor(80), hover: { color: 'userMessageBackground', backgroundColor: roomColor(80, true) } })
  await footer.unmount()
})

test('Rotate now moves to the login with the most room; the one in use is marked in use at the right end, with no switching left on it', async ($, on) => {
  const w = fresh()
  const SLOT3 = '/Users/tester/.claude/accounts/3'
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [60, 30]
  w.usage['tok-3'] = [40, 50]
  const three = { accounts: [...TWO_LOGINS.accounts, { id: '3', slot: SLOT3, email: 'three@example.com' }] }
  const clock = world(on, w, three)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'rotate' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT3 }])
  await pane.redraw()
  expect((await pane.find({ type: 'Text', text: /^● in use$/ }))?.props).toMatchObject({ color: 'warning' })
  expect(await pane.find({ text: /switching/ })).toBeUndefined()
  // Each line ends in its use, rightmost: Remove, where a login has one, stands before it.
  const ends = (await pane.findAll({ text: /^(Remove|Use now|● in use)$/ })).filter(e => e.type !== 'Box')
  expect(ends.map(e => e.text)).toEqual(['Use now', 'Remove', 'Use now', 'Remove', '● in use'])
  await pane.unmount()
})

test('a switch held back for a token about to refresh is said once and made once, when the refresh lands', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 5 * 60_000)
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'rotate' })
  await clock.settle()
  await clock.advance(2 * 60_000)
  expect(w.envSets).toEqual([])
  expect(w.toasts.filter(t => /Switching to Claude account 2/.test(t))).toHaveLength(1)
  // Claude Code refreshes the token: the next try goes through, once.
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 8 * HOUR)
  await clock.advance(3 * 60_000)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(w.toasts.filter(t => /Switched to Claude account 2/.test(t))).toHaveLength(1)
  await pane.unmount()
})

test('a login whose plan reports no weekly limit leaves its week blank in the footer', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, null]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  // Login 1, in use, has no week: blank below its braille, and no week percent at the right.
  expect((await footer.find(GLYPHS))?.text).toBe('│⣷│⣷   80% \n│ │▆       ')
  await footer.unmount()
})

test('with no weekly limit on any login, the footer leaves the week row out', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, null]
  w.usage['tok-2'] = [10, null]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect((await footer.find(GLYPHS))?.text).toBe('│⣷│⣷   80% ')
  await footer.unmount()
})

test('the pane picks each footer row\'s style for every session, and previews it with demo values', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect((await footer.find(GLYPHS))?.text).toBe('│⣷│⣷   80% \n│▆│▆   70% ')
  await pane.press({ key: 'footer-session-bars' })
  await pane.press({ key: 'footer-week-none' })
  await clock.settle()
  await footer.redraw()
  // The week's glyphs are off but its percent is still on: the row keeps just that, under the other's.
  expect((await footer.find(GLYPHS))?.text).toBe('│▇│▇   80% \n│ │    70% ')
  // Kept in the store every session reads: the next sync from it keeps the picks.
  await clock.advance(61_000)
  await footer.redraw()
  expect((await footer.find(GLYPHS))?.text).toBe('│▇│▇   80% \n│ │    70% ')
  // The demo draws imitated usage (login 1: 85% now, 70% of its week; login 2: 60%, 40%), this session only.
  await pane.press({ key: 'footer-preview-demo' })
  await pane.press({ key: 'footer-week-pie' })
  await clock.settle()
  await footer.redraw()
  expect((await footer.find(GLYPHS))?.text).toBe('│▇│▅   85% \n│◕│◑   70% ')
  // Each row's percent switches off on its own; a row with no glyphs keeps just its percent.
  await pane.press({ key: 'footer-percent-week' })
  await pane.press({ key: 'footer-session-none' })
  await clock.settle()
  await footer.redraw()
  expect((await footer.find(GLYPHS))?.text).toBe('│ │    85% \n│◕│◑       ')
  // 'tile': the column in use on the theme's dim gray, a whole cell of it either side and a space from the next
  // column, kept under the pointer, where it stands lighter than the shade.
  await pane.press({ key: 'footer-active-tile' })
  await clock.settle()
  await footer.redraw()
  expect((await footer.find(GLYPHS))?.text).toBe('         85% \n  ◕  ◑       ')
  const [padBefore, tiledOne, padAfter, untiled] = painted((await footer.find(GLYPHS))?.children[2])
  expect(padBefore).toMatchObject({ backgroundColor: 'subtle', hover: { color: 'subtle' } })
  expect(tiledOne).toMatchObject({ color: roomColor(70), backgroundColor: 'subtle', hover: { color: 'subtle', backgroundColor: roomColor(70, true) } })
  expect(padAfter).toMatchObject({ backgroundColor: 'subtle', hover: { color: 'subtle' } })
  expect(untiled).toMatchObject({ color: roomColor(40), hover: { color: 'userMessageBackground' } })
  expect(untiled?.backgroundColor).toBeUndefined()
  // 'dim the rest': no marks beside the columns, the logins not in use dimmed.
  await pane.press({ key: 'footer-active-dim' })
  await clock.settle()
  await footer.redraw()
  expect((await footer.find(GLYPHS))?.text).toBe('       85% \n ◕ ◑       ')
  const [brightOne, dimTwo] = painted((await footer.find(GLYPHS))?.children[2])
  expect(brightOne?.dimColor).toBeUndefined()
  expect(dimTwo).toMatchObject({ color: roomColor(40), dimColor: true })
  // Showing what is used fills by it, in the footer and the pane; the colors still follow the room left.
  await pane.press({ key: 'footer-fill-used' })
  await clock.settle()
  await footer.redraw()
  await pane.redraw()
  expect((await footer.find(GLYPHS))?.text).toBe('       15% \n ◔ ◑       ')
  const [usedOne, usedTwo] = painted((await footer.find(GLYPHS))?.children[2])
  expect(usedOne).toMatchObject({ color: roomColor(70) })
  expect(usedTwo).toMatchObject({ color: roomColor(40) })
  expect(await pane.find({ text: /^▰{2}▱{8} 20% used$/ })).toBeDefined()
  await pane.unmount()
  await footer.unmount()
})
