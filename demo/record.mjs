// Records demo/demo.gif: a real Claude Code session with the mod, fed imitated
// accounts by the harness in demo/harness, driven with real clicks. Two scenes:
// the camera close on the footer while the account in use runs low, pulling
// back so the session's move to the one whose 5-hour window resets soonest
// shows with the notice saying so; then the panel, its Rotation setting in
// view, trying the footer's top row as bars, pies and braille.
//
//   brew install ttyd gifski ffmpeg
//   cd demo && npm install && npx playwright install chromium
//   DEMO_LOGIN_DIR=~/.claude/accounts/3 node record.mjs [work dir]
//
// Everything the mod shows is imitated and no prompt is sent; the session
// still starts as a real account, DEMO_LOGIN_DIR's (an account folder the mod
// made) else your normal one, whose plan the header shows. That account must
// be a personal one (Pro or Max): Claude Code refuses a switch in a session on
// a Team or Enterprise account, imitated or not. Needs Claude Code
// on PATH. The terminal is drawn at three times the GIF's size, font and all,
// so the camera, applied to the frames afterwards, zooms in and stays sharp.

import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { DEMO, click, prepare, quiet, serve, sleep, waitFor, warmUp } from './session.mjs'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')

const WORK = mkdtempSync(join(process.argv[2] ?? tmpdir(), 'rotator-demo-'))
/** The GIF's size. */
const OUTPUT = { width: 1160, height: 700 }
/** The page and its font, this many times the GIF's size: the camera's deepest sharp zoom. */
const SCALE = 3
const PAGE = { width: OUTPUT.width * SCALE, height: OUTPUT.height * SCALE }
const FONT_SIZE = 17 * SCALE
const FPS = 10
/** How many shots a second the capture takes at most, ahead of the GIF's rate so each GIF frame is fresh. */
const CAPTURE_FPS = 15
const PORT = 7690
/** The file whose making starts the harness draining the account in use. */
const DRAIN = join(WORK, 'drain')

/**
 * An arrow that follows the pointer, and a ring where it clicks, `scale` times
 * their size: the screen shows no pointer of its own. The arrow joins the page
 * once it has a body, which a script that runs before the page has not.
 */
const POINTER = scale => {
  const arrow = document.createElement('div')
  arrow.innerHTML = `<svg width="${22 * scale}" height="${26 * scale}" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L13.5 22.6 L10 15.3 L17 15.3 Z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>`
  Object.assign(arrow.style, { position: 'fixed', zIndex: 2147483647, pointerEvents: 'none', display: 'none', transform: `translate(${-2 * scale}px,${-2 * scale}px)` })
  addEventListener('DOMContentLoaded', () => document.body.appendChild(arrow))
  document.addEventListener('mousemove', e => {
    Object.assign(arrow.style, { display: 'block', left: `${e.clientX}px`, top: `${e.clientY}px` })
  }, true)
  document.addEventListener('mousedown', e => {
    const ring = document.createElement('div')
    Object.assign(ring.style, {
      position: 'fixed', zIndex: 2147483646, pointerEvents: 'none', left: `${e.clientX - 14 * scale}px`, top: `${e.clientY - 14 * scale}px`,
      width: `${28 * scale}px`, height: `${28 * scale}px`, borderRadius: '50%', border: `${2 * scale}px solid #d97757`, transition: 'transform 0.4s, opacity 0.4s',
    })
    document.body.appendChild(ring)
    requestAnimationFrame(() => Object.assign(ring.style, { transform: 'scale(1.6)', opacity: '0' }))
    setTimeout(() => ring.remove(), 500)
  }, true)
}

/** Points at the footer's glyphs, a few cells left of its percent, lets its row names show, and clicks it. */
async function viaFooter(page, { pause }) {
  const at = await waitFor(page, '%')
  const glyphs = { x: at.x - 6 * at.cell.w, y: at.y }
  await page.mouse.move(glyphs.x, glyphs.y, { steps: 18 })
  await sleep(1400)
  await page.mouse.click(glyphs.x, glyphs.y)
  await sleep(pause)
}

/**
 * The page, shot as fast as a shot is taken up to `CAPTURE_FPS`, each with
 * when it was taken. A screencast hands over a page this large a frame or two
 * a second; a shot of it takes some 40 ms.
 */
async function capture(page) {
  const frames = []
  const cdp = await page.context().newCDPSession(page)
  let isOn = true
  const shooting = (async () => {
    while (isOn) {
      const at = Date.now()
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })
      frames.push({ at, image: Buffer.from(data, 'base64') })
      await sleep(Math.max(0, 1000 / CAPTURE_FPS - (Date.now() - at)))
    }
  })()
  return async () => {
    isOn = false
    await shooting
    return frames
  }
}

const FULL = { x: 0, y: 0, w: PAGE.width, h: PAGE.height }

/** Where the camera looks, in page pixels, from when, easing there from where it was over `ms`; in time order. */
const shots = [{ at: 0, rect: FULL, ms: 0 }]

/** The camera is applied once the take is shot, so a move can start before what it waits for was seen. */
function camera(rect, ms = 1500, at = Date.now()) {
  shots.push({ at, rect, ms })
  shots.sort((a, b) => a.at - b.at)
}

/** A view of the page's shape, against its right and bottom edges, that holds everything right of `left` and below `top`. */
function corner(left, top) {
  const w = Math.min(PAGE.width, Math.max(PAGE.width - left, (PAGE.height - top) * (PAGE.width / PAGE.height)))
  const h = w * (PAGE.height / PAGE.width)
  return { x: PAGE.width - w, y: PAGE.height - h, w, h }
}

/** The footer's corner, as close as the capture stays sharp. */
const FOOTER = corner(PAGE.width - OUTPUT.width, PAGE.height - OUTPUT.height)

const ease = p => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2)

/** Where the camera looks at time `t`: each shot eases from where the one before had got to. */
function cameraAt(t) {
  let rect = FULL
  for (let i = 0; i < shots.length && shots[i].at <= t; i++) {
    const shot = shots[i]
    const end = Math.min(t, shots[i + 1]?.at ?? Number.POSITIVE_INFINITY)
    const p = shot.ms === 0 ? 1 : ease(Math.min(1, (end - shot.at) / shot.ms))
    rect = { x: rect.x + (shot.rect.x - rect.x) * p, y: rect.y + (shot.rect.y - rect.y) * p, w: rect.w + (shot.rect.w - rect.w) * p, h: rect.h + (shot.rect.h - rect.h) * p }
  }
  return rect
}

/** Runs `work` over every item, `limit` at a time. */
async function pool(items, limit, work) {
  let next = 0
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) await work(items[next++])
  }))
}

/**
 * The frames at a steady rate, each the latest shot by then, framed as the
 * camera looks at that moment and brought to the page's size, into a GIF.
 */
async function encode(frames, out) {
  const dir = join(WORK, 'frames')
  mkdirSync(dir)
  const sources = frames.map((frame, i) => {
    const path = join(dir, `shot-${i}.png`)
    writeFileSync(path, frame.image)
    return path
  })
  const jobs = []
  const end = frames[frames.length - 1].at + 1500
  for (let t = frames[0].at, j = 0; t <= end; t += 1000 / FPS) {
    while (j + 1 < frames.length && frames[j + 1].at <= t) j++
    const r = cameraAt(t)
    const [w, h, x, y] = [r.w, r.h, r.x, r.y].map(Math.round)
    jobs.push({ from: sources[j], to: join(dir, `${String(jobs.length).padStart(5, '0')}.png`), crop: `crop=${w}:${h}:${x}:${y}` })
  }
  const run = promisify(execFile)
  const scale = `scale=${OUTPUT.width}:${OUTPUT.height}:flags=lanczos`
  await pool(jobs, 8, job => run('ffmpeg', ['-v', 'error', '-y', '-i', job.from, '-vf', `${job.crop},${scale}`, job.to]))
  // Full quality: below it gifski keeps pixels from earlier frames that differ only a little, which leaves
  // faint traces of the zoomed footer on the dark background once the camera pulls back.
  execFileSync('gifski', ['--fps', String(FPS), '--quality', '100', '-o', out, ...jobs.map(job => job.to)], { stdio: 'inherit' })
}

async function take(browser, script) {
  const ttyd = serve(script, { port: PORT, fontSize: FONT_SIZE, env: { DEMO_DRAIN_FILE: DRAIN, DEMO_IN_USE: 'tile' } })
  await sleep(800)
  const page = await browser.newPage({ viewport: PAGE })
  await page.addInitScript(POINTER, SCALE)
  await page.goto(`http://localhost:${PORT}`)
  await waitFor(page, '%')
  await sleep(1200)
  const stop = await capture(page)
  await sleep(1200)

  // 1. Close on the footer, its rows named under the pointer: the account in use runs low.
  // The camera is back on the whole screen by the time the session moves to the one whose
  // 5-hour window resets soonest, account 3, so the footer's change and the notice at the top show together.
  camera(FOOTER)
  await sleep(1800)
  const glyphs = await waitFor(page, '%')
  await page.mouse.move(PAGE.width * 0.75, PAGE.height * 0.7)
  await page.mouse.move(glyphs.x - 6 * glyphs.cell.w, glyphs.y, { steps: 16 })
  await sleep(1800)
  await page.mouse.move(PAGE.width * 0.55, PAGE.height * 0.55, { steps: 16 })
  await sleep(600)
  writeFileSync(DRAIN, '')
  await waitFor(page, 'Switched to Claude account 3')
  camera(FULL, 1100, Date.now() - 1700)
  await sleep(3500)

  // 2. The footer, named under the pointer, opens the panel; then its top row's glyphs, the camera on
  // both, with the Rotation setting above the footer's.
  await page.mouse.move(PAGE.width * 0.6, PAGE.height * 0.45)
  await viaFooter(page, { pause: 1800 })
  const rotation = await waitFor(page, '─ Rotation')
  camera(corner(rotation.left - rotation.cell.w * 4, rotation.top - rotation.cell.h))
  await sleep(1800)
  await click(page, '○ bars', { row: 'Session', pause: 1500 })
  await click(page, '○ pie', { row: 'Session', pause: 1500 })
  await click(page, '○ braille', { row: 'Session', pause: 1500 })

  // 3. The footer closes it again.
  camera(FULL)
  await sleep(1600)
  await viaFooter(page, { pause: 400 })
  await page.mouse.move(PAGE.width * 0.6, PAGE.height * 0.45, { steps: 14 })
  await sleep(2000)
  const frames = await stop()
  await page.close()
  await ttyd.stop()
  return frames
}

const { script, config } = prepare(WORK)
const browser = await chromium.launch()
try {
  await warmUp(browser, script, { port: PORT, fontSize: FONT_SIZE, viewport: PAGE })
  quiet(config)
  const frames = await take(browser, script)
  await encode(frames, join(DEMO, 'demo.gif'))
  console.log(`demo/demo.gif from ${frames.length} shots`)
} finally {
  await browser.close()
  if (!process.env.KEEP_WORK) rmSync(WORK, { recursive: true, force: true })
}
