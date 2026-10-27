# Getting started

Your first session, then the integrations that each need a sign-in.
[docs/usage.md](usage.md) is the full reference for every screen.

## Before you start

- Install omp and sign in to at least one model provider with `/login` in omp's terminal.
  The dashboard uses the providers omp already has; **Settings › Providers** lists them.
- Follow the README's [Quick start](../README.md#quick-start) to install the app, or run `bun run desktop` from a clone, and open it.

## Your first session

1. Click **New session** at the top of the **Sessions** tab, or press Cmd+N (Ctrl+N on Linux and Windows), or S outside a text field.
2. Pick the workspace omp runs in, and a branch or a new worktree if the folder is a git repository.
3. Type a prompt and press Enter.
   omp starts when you send the first message, so a draft you leave starts nothing.
4. While the turn runs, Enter queues a follow-up for when it finishes, Cmd+Enter (Ctrl+Enter) steers the running turn, and Esc interrupts it.
5. Cmd-click (Ctrl-click) another session in the sidebar to open it in a split pane, up to four.
6. Click **End session** in the session's header when you are done.
   Ending removes the git worktree the session worked in, and keeps its branch and any worktree with uncommitted changes.

Press `?` to list every shortcut, and Cmd+K (Ctrl+K) to open the command menu.

## See your terminal sessions

Sessions you start in a terminal show only once omp publishes them:

```sh
omp config set collab.autoStart control
```

Then restart those sessions, or run `/new` or `/collab` in each.
The [starter kit](../templates/omp/README.md) sets this for you.

## Pull requests

1. Install the [GitHub CLI](https://cli.github.com).
2. Run `gh auth login`.
3. Open the **Pull requests** tab.

## Integrations

Open **Settings › Integrations**.
Each service there reaches omp's sessions through an MCP server, so connecting it once gives both the dashboard and every new omp session its tools.
[Integrations](usage/integrations.md) describes each row's states and menu.

### Linear

1. Make sure nothing listens on port 3000: Linear sends the browser back to `localhost:3000`.
2. Click **Connect** on the Linear row and sign in.
3. Open the **Tickets** tab.

### Google Calendar

1. In a Google Cloud project, turn on the [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com).
2. Under [Credentials](https://console.cloud.google.com/apis/credentials), create an OAuth client ID of type **Web application**.
3. Add `http://localhost:3119/callback` as an authorized redirect URI.
   Use your own port instead of 3119 if you change the callback port in the form.
4. On the Google Calendar row, click **Set up**, paste the client ID and secret, and save.
5. Click **Connect** and grant the access Google asks for.
6. For omp sessions to use the calendar tools, also turn on the Calendar MCP API in the same project; the row links to it when Google refuses them.

### Gmail

1. In a Google Cloud project, turn on the [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
2. Create a **Web application** OAuth client with the redirect URI `http://localhost:3119/callback`, as for Google Calendar, or reuse the Google Calendar client.
3. On the Gmail row, click **Set up**, paste the client ID and secret, and save.
4. Click **Connect**; Google asks only for reading your email.
5. For omp sessions to use the Gmail tools, also turn on the Gmail MCP API in the same project; the row links to it when Google refuses them.

### Slack

Slack needs a dedicated app and an HTTPS redirect, so it takes the most setup.

1. Create a new internal app in [Your Slack apps](https://api.slack.com/apps); leave any existing production app unchanged.
2. In the app, open **Agents** and turn on **Slack Model Context Protocol (MCP) Server**.
3. Add the user scopes for what omp may search, read, and send; the setup form lists the scopes it accepts.
4. Turn on token rotation.
   Slack cannot turn it off later, and omp refuses a sign-in without it.
5. Register an HTTPS redirect URL on the app, and have a TLS terminator you trust forward it to the HTTP callback on this machine, port 3000 unless you change it.
   An HTTP localhost address does not work as the redirect.
6. On the Slack row, click **Set up**, paste the client ID and client secret, and save.
7. Click **Connect**.

## Set up a new computer

Two sources rebuild your setup: this repository's [starter kit](../templates/omp/README.md) and [Settings sync](usage/settings-sync.md).
Neither carries a sign-in, a session, or anything that names this machine, so a few steps stay by hand.

1. Install omp and Bun, clone this repository, and run `bun run omp-template` (add `--maintainer` for the maintainer profile).
   This installs the extensions, the `docs/` references, the kit's skills, agents, and commands, and the profile's scripts.
2. Open the dashboard, enter your remote in **Settings › Sync**, and sync.
   This brings omp's `config.yml`, `AGENTS.md`, `APPEND_SYSTEM.md`, your own skills, agents, and commands, and the dashboard's notes, todos, preferences, workspaces, source control settings, and hidden calendars.
3. The first sync has no shared base, so a file both the kit and the remote hold, such as `AGENTS.md`, conflicts when they differ; choose the remote side to keep the version you use.
4. Sign in again: model providers with `/login`, each integration under **Settings › Integrations**, `gh auth login`, and your SSH keys.
5. Recreate what stays on one machine: routines, scheduled sends, pins, and Google accounts, and reinstall omp plugins such as pstack.

Settings sync skips a skill folder that is a link, so keep each skill as a real folder under `~/.omp/agent/skills/`, and link to it from other tools instead.
Sessions and their history stay on the old computer; a todo's session link opens only there.
