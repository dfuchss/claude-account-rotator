import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, ProcessRunResult, SessionRateLimit } from 'claude-code'

import { keychainItem, weekColor } from './model'

const NOW = Date.parse('2026-10-12T10:00:00Z')
const HOUR = 3600_000
const SLOT2 = '/Users/tester/.claude/accounts/2'

type World = {
  /** keychain item name -> stored JSON */
  keychain: Record<string, string>
  /** access token -> [5-hour %, week %] */
  usage: Record<string, [number, number]>
  /** slot -> signed-in email */
  emails: Record<string, string>
  envSets: { name: string; value?: string }[]
  spawned: { argv: readonly string[]; env?: Record<string, string> }[]
  submitted: string[]
  /** What the session's last response reported, as `$.session.usage()` answers it. */
  limits: SessionRateLimit[]
  /** Ids of the panes open now. */
  panes: string[]
}

const blob = (token: string) =>
  JSON.stringify({
    claudeAiOauth: {
      accessToken: token,
      refreshToken: `refresh-${token}`,
      expiresAt: NOW + 6 * HOUR,
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
      seven_day: { utilization: week, resets_at: '2026-10-18T03:00:00Z' },
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
  on('command.register', () => ({ value: { command: 'accounts' } }))
  on('ui.toast', () => ({ value: undefined }))
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

const fresh = (): World => ({ keychain: {}, usage: {}, emails: {}, envSets: [], spawned: [], submitted: [], limits: [], panes: [] })
const TWO_LOGINS = { accounts: [{ id: '1', slot: '', email: 'one@example.com' }, { id: '2', slot: SLOT2, email: 'two@example.com' }] }

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
    expect(await band.find({ text: /login 2 \(two@example.com\) needs a sign-in \(not signed in\)/ })).toBeDefined()
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
  // Pies of the 5-hour room left, colored by the week's: login 1 (8% left) dim on standby,
  // login 2 (90% left) bright with its percent, in use.
  expect((await footer.find({ key: 'accounts' }))?.children).toMatchObject([
    { props: { color: weekColor(60), dimColor: true }, children: ['○'] },
    ' ',
    { props: { color: weekColor(70), dimColor: false }, children: ['●90%'] },
  ])
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
  expect((await footer.find({ key: 'accounts' }))?.children).toMatchObject([
    { props: { color: weekColor(70), dimColor: false }, children: ['◕80%'] },
    ' ',
    { props: { color: 'error' }, children: ['⚠'] },
  ])
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
  expect((await footer.find({ key: 'accounts' }))?.children).toMatchObject([
    { props: { color: weekColor(70), dimColor: false }, children: ['◕80%'] },
    ' ',
    { props: { color: weekColor(88), dimColor: true }, children: ['●'] },
  ])
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

test('a switch is confirmed once a response reports the new login usage', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [93, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  await clock.advance(40_000)
  w.limits = [
    { kind: 'five_hour', percentUsed: 11, resetsAt: '2026-10-12T12:00:00Z' },
    { kind: 'seven_day', percentUsed: 30, resetsAt: '2026-10-18T03:00:00Z' },
  ]
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: { title: 'Claude accounts', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
  expect(await pane.find({ text: /Requests now go out as login 2/ })).toBeDefined()
  await pane.unmount()
})

test('one press on the footer opens the accounts pane, the next closes it', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  await footer.press({ key: 'accounts' })
  await clock.settle()
  expect(w.panes).toEqual(['claude-accounts'])
  await footer.press({ key: 'accounts' })
  await clock.settle()
  expect(w.panes).toEqual([])
  await footer.unmount()
})
