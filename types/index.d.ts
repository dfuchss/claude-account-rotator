/** One usage window of a login: percent used, and when it resets (ISO 8601). */
export type UsageWindow = { pct: number; resetsAt?: string }

/** A login's usage as last read, `at` in epoch milliseconds. */
export type Reading = { fiveHour?: UsageWindow; sevenDay?: UsageWindow; at: number }

/** Whether a login can serve requests, or why not. */
export type Health =
  | { kind: 'ok'; refreshExpiresAt?: number }
  | { kind: 'login-needed'; why: string }
  | { kind: 'logging-in'; since: number }

/**
 * One Claude login. `slot` is the credentials directory Claude Code reads it
 * from: '' is the normal login, anything else an absolute directory.
 */
export type Account = {
  id: string
  slot: string
  email?: string
  /** One email can hold logins in several organizations (your Max plan, a Team seat). */
  orgId?: string
  orgName?: string
  /** `subscriptionType` as `claude auth status` reports it: max, team, pro. */
  plan?: string
}

/** How the footer draws one of its rows: a glyph per login, or not at all. */
export type Glyphs = 'bars' | 'pie' | 'braille' | 'none'

/** How the footer marks the login in use: a dark line down each side of its column, a tile behind it, or the rest dimmed. */
export type Highlight = 'lines' | 'tile' | 'dim'

/** What glyphs and bars fill with: the room a login has left, or what it has used. */
export type Fill = 'left' | 'used'

/** The footer's look, picked in the pane and kept across sessions. */
export type FooterStyle = {
  session: Glyphs
  week: Glyphs
  /** Whether a row ends with the login in use's percent. */
  sessionPercent: boolean
  weekPercent: boolean
  active: Highlight
  /** Either way the colors go from green with all the room left to red with none. */
  fill: Fill
}

/** A run of the footer's text: its color, and the lighter one it takes while the pointer is over the footer. */
export type FooterRun = { text: string; color?: string; lit?: string; backgroundColor?: string; dimColor?: boolean }

/** Everything the footer, band and pane draw from. */
export type View = {
  accounts: Account[]
  readings: Record<string, Reading>
  health: Record<string, Health>
  /** The login this session sends its requests with. */
  activeId: string
  /** Set after a switch until a response shows the new login's usage. */
  pending?: { id: string; from: string; since: number }
  /** Account id whose removal waits for a second press. */
  removing?: string
  footer: FooterStyle
  /** This session only: the footer draws imitated usage, to judge its look. */
  demo?: boolean
  /** This session's terminal draws block characters from its font, short of the line, as Terminal.app does. */
  hasFontBlocks: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'account-rotator': { view: View }
  }
}
