// Draws demo/looks.png: the footer's looks side by side, each shot from a real
// Claude Code session with the mod, fed imitated accounts by the harness in
// demo/harness. One session picks each look in the panel with real clicks; a
// second starts with an account signed out, for the footer asking for a
// sign-in and then signing in. Needs what record.mjs needs:
//
//   DEMO_LOGIN_DIR=~/.claude/accounts/3 node looks.mjs [work dir]

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEMO, click, prepare, quiet, serve, sleep, waitFor, warmUp } from './session.mjs'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')

const WORK = mkdtempSync(join(process.argv[2] ?? tmpdir(), 'rotator-looks-'))
/** The terminal drawn at three times a 17px font, as record.mjs draws it, so the shots stay sharp on the sheet. */
const SCALE = 3
const PAGE = { width: 1160 * SCALE, height: 700 * SCALE }
const FONT_SIZE = 17 * SCALE
const PORT = 7691
/** How much larger than in the terminal a footer shows on the sheet. */
const ZOOM = 1.5

/**
 * The looks the panel picks, in the order they are shot, each from the one
 * before: the clicks that make it, as an option's text and its setting's name.
 * The first session starts at the default, braille over bars, lines either
 * side of the account in use, room left, both percents.
 */
const PICKS = [
  ['bars', [['○ bars', 'Session']]],
  ['pie', [['○ pie', 'Session'], ['○ pie', 'Week']]],
  ['braille', [['○ braille', 'Session'], ['○ braille', 'Week']]],
  ['tile', [['○ bars', 'Week'], ['○ tile', 'In use']]],
  ['dim the rest', [['○ dim the rest', 'In use']]],
  ['used', [['○ lines', 'In use'], ['○ used', 'Show']]],
  ['no percents', [['○ room left', 'Show'], ['■ session', 'Percent'], ['■ week', 'Percent']]],
  ['no glyphs', [['□ session', 'Percent'], ['□ week', 'Percent'], ['○ none', 'Session'], ['○ none', 'Week']]],
]

/** The sheet's rows: a name, then the shots it shows, by the captions they carry. */
const SHEET = [
  ['Glyphs', ['bars', 'pie', 'braille']],
  ['In use', ['lines', 'tile', 'dim the rest']],
  ['Show', ['used', 'no percents', 'no glyphs']],
  ['States', ['needs a sign-in', 'signing in', 'pointer on it']],
]

/** Somewhere the pointer lights nothing: the transcript's top left. */
const away = page => page.mouse.move(PAGE.width * 0.1, PAGE.height * 0.1)

/**
 * The footer, its two rows at the screen's bottom right, cut to what it draws:
 * from the first cell that holds anything or a color of its own, as the tile's
 * and the shade's blank cells do, to the last, at most `reach` cells left of the
 * screen's right edge so the mode label left of it stays out.
 */
async function shoot(page) {
  const at = await page.evaluate(reach => {
    const term = window.term
    const buffer = term.buffer.active
    const box = term.element.querySelector('.xterm-screen').getBoundingClientRect()
    const cell = { w: box.width / term.cols, h: box.height / term.rows }
    const filled = []
    for (const r of [term.rows - 2, term.rows - 1]) {
      const line = buffer.getLine(buffer.viewportY + r)
      for (let x = term.cols - reach; x < term.cols; x++) {
        const cell = line?.getCell(x)
        const chars = cell?.getChars() ?? ''
        if ((chars !== '' && chars !== ' ') || cell?.isBgDefault() === false) filled.push(x)
      }
    }
    return { box, cell, rows: term.rows, first: Math.min(...filled), last: Math.max(...filled) }
  }, 26)
  const clip = {
    x: at.box.left + at.first * at.cell.w,
    y: at.box.top + (at.rows - 2) * at.cell.h,
    width: (at.last - at.first + 1) * at.cell.w,
    height: 2 * at.cell.h,
  }
  return { image: await page.screenshot({ clip }), width: clip.width, height: clip.height }
}

/** Every look the panel picks, and the footer under the pointer, from one session. */
async function picked(browser, script, shots) {
  const ttyd = serve(script, { port: PORT, fontSize: FONT_SIZE })
  await sleep(800)
  const page = await browser.newPage({ viewport: PAGE })
  await page.goto(`http://localhost:${PORT}`)
  const percent = await waitFor(page, '%')
  await sleep(2500)
  shots.set('lines', await shoot(page))
  const glyphs = { x: percent.x - 6 * percent.cell.w, y: percent.y }
  await page.mouse.move(glyphs.x, glyphs.y, { steps: 8 })
  await sleep(1200)
  shots.set('pointer on it', await shoot(page))
  await page.mouse.click(glyphs.x, glyphs.y)
  await away(page)
  await waitFor(page, '─ Display')
  for (const [look, clicks] of PICKS) {
    for (const [text, row] of clicks) await click(page, text, { row, pause: 400 })
    await away(page)
    await sleep(900)
    shots.set(look, await shoot(page))
  }
  await page.close()
  await ttyd.stop()
}

/** The footer while an account needs a sign-in, then while it signs in, from a session that starts it signed out. */
async function signIn(browser, script, shots) {
  const ttyd = serve(script, { port: PORT, fontSize: FONT_SIZE, env: { DEMO_SIGNED_OUT: '3' } })
  await sleep(800)
  const page = await browser.newPage({ viewport: PAGE })
  await page.goto(`http://localhost:${PORT}`)
  await waitFor(page, '%')
  await waitFor(page, '⚠', 30_000, '%')
  await sleep(1500)
  shots.set('needs a sign-in', await shoot(page))
  await click(page, 'Sign in', { pause: 0 })
  await away(page)
  await waitFor(page, '◌', 10_000, '%')
  await sleep(400)
  shots.set('signing in', await shoot(page))
  await page.close()
  await ttyd.stop()
}

/** The shots on one sheet, a row per name, each with its caption, drawn at twice the size it is laid out at. */
async function sheet(browser, shots, out) {
  const img = name => {
    const shot = shots.get(name)
    const size = `width:${(shot.width / SCALE) * ZOOM}px;height:${(shot.height / SCALE) * ZOOM}px`
    return `<figure><img style="${size}" src="data:image/png;base64,${shot.image.toString('base64')}"><figcaption>${name}</figcaption></figure>`
  }
  const rows = SHEET.map(([name, looks]) => `<div class="name">${name}</div>${looks.map(img).join('')}`).join('')
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } })
  await page.setContent(`<!doctype html><style>
    body { margin: 0; background: transparent }
    #sheet { display: inline-grid; grid-template-columns: auto repeat(3, auto); gap: 28px 40px; align-items: center;
      padding: 30px 40px; background: #1f1f1f; border-radius: 14px; font: 16px/1.2 -apple-system, BlinkMacSystemFont, sans-serif }
    .name { color: #c9c9c9; font-weight: 600 }
    figure { margin: 0 }
    img { display: block }
    figcaption { margin-top: 8px; color: #8c8c8c; font-size: 15px }
  </style><div id="sheet">${rows}</div>`)
  await page.locator('#sheet').screenshot({ path: out, omitBackground: true })
  await page.close()
}

const { script, config } = prepare(WORK)
const browser = await chromium.launch()
try {
  await warmUp(browser, script, { port: PORT, fontSize: FONT_SIZE, viewport: PAGE })
  quiet(config)
  const shots = new Map()
  await picked(browser, script, shots)
  await signIn(browser, script, shots)
  await sheet(browser, shots, join(DEMO, 'looks.png'))
  console.log(`demo/looks.png from ${shots.size} shots`)
} finally {
  await browser.close()
  if (!process.env.KEEP_WORK) rmSync(WORK, { recursive: true, force: true })
}
