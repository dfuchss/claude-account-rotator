# Claude account rotator

A [Claude Code](https://code.claude.com) mod for people with more than one Claude account. It shows each account's usage under the prompt, and moves your session to another account before the one in use runs out.

![The footer up close as the account in use runs low; the session moves to another account and a notice says so; then the panel switches the footer's top row between bars, pies and braille](demo/demo.gif)

<sub>A real session fed imitated accounts (`demo/harness`), so no real account appears.</sub>

## Install

```
/plugin install account-rotator --marketplace ivokund/claude-account-rotator
```

Then click the usage in the footer, press **+ Add an account** and approve the sign-in in your browser. The account you are signed in with now is account 1.

## The footer

A column per account. The top row is the room it has right now (its 5-hour window, or none once its week is spent), the bottom row its week: green with plenty left, red with little. The percents are the account in use's.

Click it for the panel: each account's usage and reset times, **Sign in**, **Use now** and **Remove**, **+ Add an account**, **Rotate now**, **Rotation**, which picks the account it moves to, and **Display**, which picks the footer's look:

![The footer's looks. Glyphs: bars, pies or braille. The account in use: between lines, on a tile, or with the rest dimmed. Counting what is used instead of the room left, without percents, or without glyphs. An account that needs a sign-in, one signing in, and the rows' names under the pointer.](demo/looks.png)

## What it does

- **Rotates.** Once the account in use is down to 10% of its 5-hour window or 5% of its week, the session moves to another account, and a notice says which and why. **Rotation** in the panel picks which: by default the one whose 5-hour window resets soonest, so room about to refill is used before it does; else the one with the most room, or the next in the list; or **disabled**, which leaves switching to you.
- **Recovers.** A turn that still hits a usage limit or a rejected sign-in switches accounts and asks Claude to carry on.
- **Warns.** When every account is near its limit, a line above the prompt says when the next one frees up. When an account needs signing in again, the same line says so and signs it in with one click.

## Requirements

- macOS, where Claude Code keeps sign-ins in the keychain, or Linux, where it keeps them in files.
- Claude Code 2.1.296 or later, in its fullscreen renderer (`/tui fullscreen`), the only one that passes clicks on: the panel opens with a click.
- Any Mac terminal: Terminal.app, iTerm2, Ghostty, Warp, VS Code; on Linux, one with mouse reporting. In iTerm2 the profile's *Enable mouse reporting* must be on, in tmux `set -g mouse on`, and iTerm2's `tmux -CC` mode can't run fullscreen.
- Claude subscription accounts (tested with Max and Team seats), with the session started on a personal one, Pro or Max: see [Team and Enterprise accounts](#team-and-enterprise-accounts).

Claude Code's own "You've used N% of your session limit" warning can still show for a minute after a switch: the switch lands within about 35 seconds, and warnings Claude Code queued before it still play. No mod can hide it.

Mods are early access in Claude Code, and this one relies on internals a release can change: where sign-ins are stored, and the usage endpoint behind `/usage`.

## Team and Enterprise accounts

Since 2.1.295, Claude Code runs a built-in security default in every session on a Team or Enterprise account, and on any machine with managed settings. It keeps the plugins you install from changing where Claude Code reads its sign-in, which is how this mod switches. In such a session the mod can't switch, and it says so as the session starts and at the top of the panel.

So start Claude Code on a personal account, Pro or Max. From there it moves to your Team seats and back.

- **Every new session starts on your normal login**, the one your last `/login` saved. A switch by the mod changes only the session it is made in.
- **Keep that normal login personal.** If you `/login` with a Team account, every new session starts on Team and can't switch. Run `/login` with your personal account once to fix it.
- **Add and renew Team seats from the panel** (**+ Add an account**, **Sign in**), not with `/login`. The panel signs each account in to its own folder and leaves your normal login alone.
- **After a plugin reload on a Team seat, start a new session.** Since 2.1.299, installing, enabling or disabling a plugin while a Team account is in use blocks switching until that session ends.

### Turning the security default off

> [!WARNING]
> This removes a security protection for every plugin and every session on the machine. With it off, a plugin you install can override what an organization's policy sets for Claude Code (its hooks, prompt content, settings, tool and MCP server rules) and change where Claude Code reads sign-ins and settings from. Anthropic's [Usage Policy](https://www.anthropic.com/legal/aup) forbids intentionally bypassing restrictions or guardrails built into its products. This is a setting Claude Code offers administrators, but using it so a Team session can switch accounts may count as bypassing. Do it only on a machine you alone control, with plugins you trust. Never do it where an organization manages Claude Code, or where your Team or Enterprise organization's rules forbid it.

Managed settings decide whether the default runs: once they set `prependPlugins`, it runs only if listed there. The file must be owned by an administrator, since Claude Code ignores this key in a file your account can write. If the file below already exists, it holds your organization's policy: leave it alone. Otherwise:

```sh
# macOS
sudo mkdir -p "/Library/Application Support/ClaudeCode"
echo '{ "prependPlugins": [] }' | sudo tee "/Library/Application Support/ClaudeCode/managed-settings.json"

# Linux
sudo mkdir -p /etc/claude-code
echo '{ "prependPlugins": [] }' | sudo tee /etc/claude-code/managed-settings.json
```

It applies to sessions started after. Delete the file to turn the default back on. Managed settings an organization sends from Anthropic's servers can override it.

Untested: this follows how Claude Code 2.1.299 describes and reads the setting, but it has not been tried end to end, and a release can change it. You use it at your own risk.

## How it works

- Each account you add gets a folder, `~/.claude/accounts/<n>`, and Claude Code keeps its sign-in in the keychain under that folder's name (on Linux, in that folder's `.credentials.json`), as for any config folder. A switch points the session at another account's sign-in.
- Its only network traffic: each account's usage every 10 minutes, from the endpoint `/usage` reads, with that account's own token. Tokens stay where Claude Code keeps them; the mod stores each account's email, organization, plan and last usage.

## Uninstall

Remove each account in the panel, which signs it out, then run `claude plugin uninstall account-rotator@claude-account-rotator` and delete `~/.claude/accounts`.

## Terms

As of October 2026:

- Neither Anthropic's [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) (October 8, 2025) nor its [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) (June 17, 2025) forbid one person from holding more than one Claude account. The Consumer Terms forbid sharing an account's login details, so add only your own. A Team or Enterprise seat is also under its organization's rules.
- Claude Code's [legal page](https://code.claude.com/docs/en/legal-and-compliance) says the advertised usage limits of Pro and Max assume ordinary, individual usage. It also says Anthropic may enforce its rules on sign-ins and credentials without notice. The mod signs accounts in only through Claude Code's own `claude auth login` and keeps no tokens of its own.
- The Consumer Terms forbid reaching the Services "through automated or non-human means" except with an API key. The mod's usage check every 10 minutes and its "carry on" prompt after a switch run inside Claude Code, as part of your own session, but judge that for yourself.
- The [Usage Policy](https://www.anthropic.com/legal/aup) forbids intentionally bypassing restrictions or guardrails built into Anthropic's products: read the warning in [Turning the security default off](#turning-the-security-default-off) first.

Terms change; this is not legal advice. Not affiliated with or endorsed by Anthropic.

## Develop

```
claude --plugin-dir .     # a session with the mod loaded from this folder
claude plugin validate .
claude plugin test .
```

`demo/record.mjs` records the GIF and `demo/looks.mjs` draws the footer's looks, both from a real session fed imitated accounts; their headers say what they need.

## License

[MIT](LICENSE)
