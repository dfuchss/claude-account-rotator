// What the recorders share: a real Claude Code session with the mod, fed
// imitated accounts by the harness in demo/harness, served in a browser by
// ttyd, and finding text on its screen to point at.

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEMO = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(DEMO)
const LOGIN_DIR = process.env.DEMO_LOGIN_DIR ?? ''

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * A fresh Claude Code config in `work` with onboarding done and the demo
 * folder trusted, and the script that starts a session on it. The session
 * draws fullscreen, the renderer that passes clicks on, and takes the
 * harness's cues from the environment `serve` gives it.
 */
export function prepare(work) {
  const config = join(work, 'config')
  const project = join(work, 'acme-app')
  mkdirSync(config)
  mkdirSync(project)
  const trusted = execFileSync('realpath', [project]).toString().trim()
  writeFileSync(
    join(config, '.claude.json'),
    JSON.stringify({
      hasCompletedOnboarding: true,
      theme: 'dark',
      projects: { [trusted]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } },
    }),
  )
  const script = join(work, 'claude.sh')
  writeFileSync(
    script,
    `#!/bin/sh
cd "${project}"
exec env -i HOME="$HOME" USER="$USER" PATH="$PATH" LANG=en_US.UTF-8 TZ=UTC TERM=xterm-256color COLORTERM=truecolor \\
  CLAUDE_CONFIG_DIR="${config}" CLAUDE_SECURESTORAGE_CONFIG_DIR="${LOGIN_DIR}" CLAUDE_CODE_NO_FLICKER=1 IS_DEMO=1 CLAUDE_CODE_HIDE_CWD=1 \\
  DEMO_DRAIN_FILE="$DEMO_DRAIN_FILE" DEMO_IN_USE="$DEMO_IN_USE" DEMO_SIGNED_OUT="$DEMO_SIGNED_OUT" \\
  claude --plugin-dir "${REPO}" --plugin-dir "${join(DEMO, 'harness')}"
`,
    { mode: 0o755 },
  )
  return { script, config }
}

/**
 * Marks what a new user is shown at start as already seen, so a take opens
 * on a clean screen: every startup announcement in the remote config the
 * warm-up cached, and the guest-passes offer.
 */
export function quiet(config) {
  const file = join(config, '.claude.json')
  const state = JSON.parse(readFileSync(file, 'utf8'))
  const announced = state.cachedGrowthBookFeatures?.tengu_startup_announcements ?? []
  state.announcementImpressions = Object.fromEntries(announced.map(a => [a.id, a.maxImpressions]))
  state.hasVisitedPasses = true
  state.passesLastSeenRemaining = Math.max(state.passesLastSeenRemaining ?? 0, 99)
  writeFileSync(file, JSON.stringify(state))
}

/** Serves the session on `port`, its font `fontSize` pixels, with the harness's cues in `env`. */
export function serve(script, { port, fontSize, env = {} }) {
  const theme = JSON.stringify({ background: '#1f1f1f', foreground: '#e6e6e6', cursor: '#e6e6e6' })
  // The canvas renderer draws block characters to fill their cells, so the logo and the bars come out whole;
  // the DOM renderer leaves them to the font, which draws them short of the line.
  const args = ['-p', String(port), '-W', '-o', '-t', `fontSize=${fontSize}`, '-t', 'fontFamily=Menlo, monospace', '-t', 'rendererType=canvas']
  args.push('-t', 'disableLeaveAlert=true', '-t', 'disableResizeOverlay=true', '-t', `theme=${theme}`, script)
  const child = spawn('ttyd', args, { stdio: 'ignore', env: { ...process.env, ...env } })
  const exited = new Promise(resolve => child.once('exit', resolve))
  return { stop: () => (child.kill(), exited), exited }
}

/** One short session, so a fresh config has seen its first-run notices and cached its remote config. */
export async function warmUp(browser, script, { port, fontSize, viewport }) {
  const ttyd = serve(script, { port, fontSize })
  await sleep(800)
  const page = await browser.newPage({ viewport })
  await page.goto(`http://localhost:${port}`)
  await sleep(9000)
  await page.close()
  await ttyd.stop()
}

/**
 * Where a text shows on the terminal's screen, its first match from the bottom
 * on a line that also holds `row`: its centre, its left and top edges, and a
 * cell's size, in page pixels.
 */
export async function locate(page, text, row = '') {
  return page.evaluate(([needle, within]) => {
    const term = window.term
    const buffer = term.buffer.active
    const box = term.element.querySelector('.xterm-screen').getBoundingClientRect()
    const cell = { w: box.width / term.cols, h: box.height / term.rows }
    for (let r = term.rows - 1; r >= 0; r--) {
      const line = buffer.getLine(buffer.viewportY + r)?.translateToString(false) ?? ''
      const col = line.indexOf(needle)
      if (col === -1 || !line.includes(within)) continue
      const left = box.left + col * cell.w
      const top = box.top + r * cell.h
      return { x: left + (needle.length / 2) * cell.w, y: top + cell.h / 2, left, top, cell }
    }
    return undefined
  }, [text, row])
}

export async function waitFor(page, text, timeoutMs = 60_000, row = '') {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const at = await locate(page, text, row)
    if (at !== undefined) return at
    await sleep(200)
  }
  throw new Error(`"${text}" never showed`)
}

/** Moves the pointer there first, as a hand would, so the press lands on a hovered element. */
export async function click(page, text, { pause = 900, row = '' } = {}) {
  const at = await waitFor(page, text, 60_000, row)
  await page.mouse.move(at.x, at.y, { steps: 18 })
  await sleep(250)
  await page.mouse.click(at.x, at.y)
  await sleep(pause)
}
