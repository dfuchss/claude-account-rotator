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

/** Everything the footer, band and pane draw from. */
export type View = {
  accounts: Account[]
  readings: Record<string, Reading>
  health: Record<string, Health>
  /** The login this session sends its requests with. */
  activeId: string
  /** Set after a switch until a response shows the new login's usage. */
  pending?: { id: string; from: string; since: number }
  /** The last thing the mod did or noticed, in one line. */
  note?: string
  /** Account id whose removal waits for a second press. */
  removing?: string
}

declare module 'claude-code' {
  interface PluginState {
    'account-rotator': { view: View }
  }
}
