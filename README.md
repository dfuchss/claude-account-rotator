# Claude account rotator

A [Claude Code](https://code.claude.com) mod for people with more than one Claude login. It shows how much room each login has left right under the prompt, moves your session to another login before the one in use runs out, and signs a login back in with one click when it needs it.

![Close on the footer, the login in use runs low and the session moves to another, with a notice saying so; then the panel switches the footer's top row between bars, pies and braille](demo/demo.gif)

<sub>Recorded in a real Claude Code session fed imitated logins (`demo/harness`), so no real account appears.</sub>

## Install

In Claude Code:

```
/plugin install account-rotator --marketplace ivokund/claude-account-rotator
```

Answer `y` to add the marketplace, then pick a scope (user installs it for every project). Or from a shell:

```
claude plugin marketplace add ivokund/claude-account-rotator
claude plugin install account-rotator@claude-account-rotator
```

Then click the usage in the footer (or type `/accounts`), press **+ Add a login** and approve the sign-in in your browser. The login you already use is login 1; add the others you have.

## What it does

- **Footer.** One column per login, right of the prompt. The top row is what a login can serve right now: its 5-hour window, or nothing once its week is spent. The bottom row is its week. Green means plenty of room, red means little. The login in use is marked, and its percents show at the right. `⚠` means a login needs a sign-in, `◌` that one is signing in. Point at the footer and each row's name shows at its left; click it to open or close the panel.
- **Rotation.** Once the login in use has 10% of its 5-hour window or 5% of its week left, the session moves to the login that can serve the most right now, and a notice says which and why. Requests go out as that login within half a minute. If a turn still fails on a usage limit or a rejected sign-in, it switches and asks Claude to carry on. When every login is near its limit, the band above the prompt says when the next one frees up.
- **Panel.** Each login's 5-hour and weekly usage with their reset times, with Sign in, Use now and Remove; the one in use is drawn brightest. **+ Add a login** adds one, and **Rotate now** moves to the login with the most room without waiting for the one in use to run low. The Display settings pick the footer's glyphs per row (bars, pie, braille or none), its percents, whether glyphs fill with the room left or with what is used, and how the login in use is marked (lines, a tile or the rest dimmed). They apply to every session, and a preview tries them on sample values.
- **Sign-ins.** Each login you add signs in once, through your browser. The panel warns when a login's sign-in will run out within three days; when one needs signing in again, the band above the prompt says so and does it in one click.

## Requirements

- Claude Code 2.1.296 or later, the version it is built and tested on. Mods are an early-access part of Claude Code, and the mod relies on internals (`CLAUDE_SECURESTORAGE_CONFIG_DIR`, where logins are stored, and the usage endpoint behind `/usage`) that a release can change.
- macOS: logins are read from the macOS keychain, where Claude Code keeps them. Other platforms keep them elsewhere, which the mod does not read yet.
- Claude subscription logins, signed in through claude.ai (tested with Max and Team seats).
- A terminal that passes the mouse through, clicks and movement, to use the footer (in tmux, `set -g mouse on`); `/accounts` opens the panel without one.
- A font with braille and block characters, which most monospace fonts have (pies also need `◔ ◑ ◕`), and 24-bit color for the smoothest gradient.

## How it works

Each login you add gets a folder, `~/.claude/accounts/<n>`, and Claude Code keeps its sign-in in the keychain under a name derived from that folder, as it does for any config folder. Switching points the session at another login's stored sign-in.

Every 10 minutes the mod asks the endpoint `/usage` reads for each login's usage, with that login's own token while the token is valid. A login whose token has lapsed keeps its last reading, with any window that has reset since counted as unused, until a session uses it again. The usage of the login in use also comes with every response. The usage calls are the mod's only network traffic; signing in and out runs `claude auth`. Tokens stay in the keychain. The mod keeps the list of logins (email, organization, plan), their last usage and the footer's look in its plugin store.

## Uninstall

Remove each added login in the panel, which signs it out, then run `claude plugin uninstall account-rotator@claude-account-rotator`. Delete `~/.claude/accounts` to drop the empty folders.

## Terms

When this was written (October 2026), neither Anthropic's [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) (effective October 8, 2025) nor its [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) (effective June 17, 2025) forbade one person from holding more than one Claude account. The Consumer Terms do forbid sharing an account's login with anyone else, so add only your own. Terms change; read the current ones. This is not legal advice.

Not affiliated with or endorsed by Anthropic.

## Develop

```
claude --plugin-dir .     # a session with the mod loaded from this folder
claude plugin validate .
claude plugin test .
```

`demo/record.mjs` records `demo/demo.gif` from a real session fed imitated logins; its header says what it needs.

## License

[MIT](LICENSE)
