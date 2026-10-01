# Work on Pinched on your own computer

From an empty machine to a running app and your first pushed change. Deploying is a separate guide:
[deploying.md](deploying.md).

## 1. Install once

You need Git, Node 22, pnpm 10 and (optionally) Claude Code.

**macOS**

```bash
xcode-select --install     # Git and the build tools; skip if `git --version` already works
```

Install Node 22 from nodejs.org or with a version manager (nvm, fnm or Volta; the repo's `.nvmrc` says
22), then switch on pnpm. Corepack ships with Node and picks the exact pnpm version the repo pins:

```bash
corepack enable            # if it says permission denied, run it with sudo
node --version             # v22.x
pnpm --version             # 10.x
```

**Windows.** Use WSL2, which gives you a Linux terminal inside Windows. In an Administrator PowerShell
run `wsl --install`, restart, open the Ubuntu app, and follow the Linux steps there. Keep the project
in Linux's own home folder (`~/pinched-app`), not under `/mnt/c`, or everything is slow. The scripts
also use `cross-env` and should run in plain PowerShell with Git for Windows, but the project has only
been developed and tested on Linux.

**Linux.** Install `git` and `curl` with your package manager, Node 22 (nvm, fnm or NodeSource), then
`corepack enable`.

**Claude Code** (to have Claude edit the project on your machine):

```bash
curl -fsSL https://claude.ai/install.sh | bash     # macOS, Linux, WSL
irm https://claude.ai/install.ps1 | iex            # Windows PowerShell
brew install --cask claude-code                    # or Homebrew
```

Then run `claude` once and sign in with your Claude account.

**GitHub.** Reading this public repository needs nothing. Pushing needs you signed in: install the
GitHub CLI (`brew install gh`, or cli.github.com) and run `gh auth login`, or use GitHub Desktop.

## 2. Run it

```bash
git clone https://github.com/benackles/pinched-app
cd pinched-app
pnpm install
pnpm dev:local
```

Open <http://localhost:3000> and sign in with any email. It runs the whole app with no accounts and no
keys: a real Postgres (PGlite), your files on disk, and a "Try Pro locally" switch in Settings instead of
Stripe. Your data lives in `.pinched-local/` (git-ignored); delete that folder to start over. Stop it
with Ctrl+C. If port 3000 is taken, run `pnpm dev:local -p 3001`.

## 3. Work with Claude on your machine

- **Start a session in the project.** `cd pinched-app && claude`. Claude reads `CLAUDE.md` and
  `AGENTS.md` for the project's rules, and the running app reloads as it edits. Describe what you want
  in plain English.
- **Carry a cloud session across.** On claude.ai/code open the session's menu and choose **Open in →
  Terminal**: it copies the exact command, `claude --teleport <session-id>`. Run it inside your clone.
  It checks out the session's branch and loads the conversation; new work then stays on your machine.
  It needs a clean git state (it offers to stash), a clone of this repository rather than a fork, the
  branch pushed to GitHub, and the same Claude account.
- **The Claude desktop app** can also run a session on your machine: start a session and choose
  **Local** instead of **Cloud**, then pick the project folder.
- **Steer a local session from your phone or browser** with `claude remote-control` in the folder.

## 4. The daily loop

```bash
git switch -c my-change                   # one branch per change
pnpm dev:local                            # keep it running while you work
pnpm check                                # before you commit: format, lint, types, ~700 tests (~25 s)
pnpm exec playwright install chromium     # once, for the browser tests
pnpm test:e2e                             # phone and desktop browser tests
git add -A && git commit -m "What changed and why"
git push -u origin my-change              # then open the pull request GitHub offers
```

CI runs the same checks and the browser tests on a production build, and Vercel builds a Preview of
the branch. Merging into `main` deploys Production. Changing the database has an extra step: see
"Changing the database" in [deploying.md](deploying.md).

To use real Clerk, Supabase and Stripe accounts locally instead of the demo mode, copy `.env.example`
to `.env.local`, fill in what you need, and run `pnpm dev`.

## 5. When it won't start

- **`pnpm: command not found`.** Run `corepack enable` (with `sudo` if refused), or
  `npm install -g pnpm@10`.
- **A warning about the Node version, or odd errors.** Node isn't 22. Run `nvm use` in the folder
  (it reads `.nvmrc`) or install Node 22.
- **Port 3000 is busy.** `pnpm dev:local -p 3001`, or stop whatever is using it.
- **Strange build errors after switching branches or pulling.** Start clean:
  `rm -rf .next node_modules && pnpm install`.
- **A sign-in page that says sign-in isn't set up.** You ran `pnpm dev`, which wants real keys. Use
  `pnpm dev:local`.
- **Some tests are skipped.** The Edge Function tests need Deno and OpenSSL; they are skipped without
  them, which is fine.
