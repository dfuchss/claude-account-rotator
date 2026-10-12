# Claude account rotator

A Claude Code mod that keeps several Claude logins signed in and moves a session to another one when the login in use nears its usage limit.

- **Footer:** one pie per login, right of the prompt. The pie is what the login can serve right now: its 5-hour room left, or empty once its week is spent. Its color is the weekly room left, green through yellow to red. The login in use is bright and shows its percent; `⚠` means it needs a sign-in. Click to open or close the panel.
- **Panel:** each login's 5-hour and weekly usage, with Sign in, Use now and Remove, and **+ Add a login**.
- **Rotation:** at 90% of the 5-hour limit or 95% of the weekly one, the session moves to the login with the most 5-hour room left. When a turn dies on a usage limit, it switches and asks Claude to carry on.
- **Logins:** your normal login is login 1. Each added login gets a folder under `~/.claude/accounts/<n>` and its sign-in is kept in the macOS keychain. Signing in opens your browser.

## Install

```
/plugin install account-rotator --marketplace ivokund/claude-account-rotator
```

## Develop

```
claude plugin validate .
claude plugin test .
```

macOS only: it reads the keychain with `security`. It relies on Claude Code internals (`CLAUDE_SECURESTORAGE_CONFIG_DIR`, the OAuth usage endpoint) that can change between releases.
