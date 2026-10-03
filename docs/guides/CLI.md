# CardSpoke CLI

**Status:** current (experimental) · **Applies to:** 0.21.1, schema v4

The CardSpoke CLI edits CardSpoke data from a terminal. It is built for
scripts and AI agents: every command can print JSON, errors exit non-zero
with a stable error code, and the CLI never uses the network.

It runs the same headless card engine as the app (`www/src/kernel.js`), so
cards created or changed by the CLI follow the app's rules for IDs, tags,
hierarchy and `[[links]]`.

## What the CLI works on

### Desktop app: the data folder (recommended)

The desktop app saves every dataset as a JSON file in a data folder you
choose (default `Documents/CardSpoke`; see the
[Desktop guide](./DESKTOP.md#where-data-lives)). The CLI finds that folder on
its own and edits those files directly:

```bash
cardspoke datasets                       # list the datasets in the folder
cardspoke tree                           # the dataset open in the desktop app
cardspoke create "Idea" -d "Research"    # a dataset by name or key
cardspoke init --dataset "New Project"   # create a dataset in the folder
```

You can do this **while the desktop app is open**. The app notices the
changed file and reloads it. If you have unsaved edits at that moment, it
asks whether to keep your version or load the file.

The CLI finds the folder in this order:

1. `--data-dir DIR`
2. `$CARDSPOKE_DATA_DIR`
3. the folder recorded by the desktop app in `storage.json` in its profile
   directory (`%APPDATA%\CardSpoke`, `~/Library/Application Support/CardSpoke`,
   or `~/.config/CardSpoke`; override with `$CARDSPOKE_DESKTOP_CONFIG_DIR`)

### Any other CardSpoke JSON file

`--file` works on a standalone file instead:

| File | Where it comes from | How the app reads it back |
| --- | --- | --- |
| Instance backup (`exportType: "instance"`) | **Export JSON** in the app, or `cardspoke init --file` | **Import JSON** in the app |
| Raw dataset payload (`rootOrder`) | A data-folder file, or a dataset using the web app's local-file storage | Loaded by the app |

Both can be PIN-encrypted. The CLI saves a file in the same format and
encryption it was loaded with. In the web app (no data folder), the round
trip is: export JSON, edit it with the CLI, import it.

### Which dataset a command uses

1. `--file FILE`
2. `--dataset NAME` (a dataset key such as `cards_research_ab12`, its file
   name, or its name as shown in the app; an encrypted dataset's name is
   hidden, so use its key)
3. `$CARDSPOKE_FILE`, then `$CARDSPOKE_DATASET`
4. the dataset open in the desktop app (or the only dataset in the folder)
5. `./cardspoke.json` when there is no data folder

`--json` output includes `file` (and `dataset` for data-folder datasets), so
you can always see which file a command changed.

## Running it

Node 20.19+ or 22.12+ is required. No dependencies need to be installed.

```bash
node cli/cardspoke.js help      # from a checkout
npm run cli -- help             # same, through npm
npm link && cardspoke help      # put `cardspoke` on your PATH
```

### Global flags

| Flag | Meaning |
| --- | --- |
| `--dataset NAME`, `-d NAME` | A dataset in the data folder, by key or name. `$CARDSPOKE_DATASET` also works. |
| `--file FILE`, `-f FILE` | A standalone dataset or backup file. `$CARDSPOKE_FILE` also works. |
| `--data-dir DIR` | The data folder. Default: `$CARDSPOKE_DATA_DIR`, else the desktop app's folder. |
| `--json` | Print `{ "ok": true, "command", "data", "saved"? }` or `{ "ok": false, "error": { "code", "message", "details"? } }`. |
| `--pin PIN` | PIN for an encrypted file. `$CARDSPOKE_PIN` also works and keeps the PIN out of the shell history. |
| `--dry-run` | Run the command and print the result, but write nothing. |
| `--help`, `-h` | Show help for a command. |

### Referring to cards

Wherever a command takes a card, pass its **ID** or its **exact title**
(case- and whitespace-insensitive). If a title matches more than one card,
the command fails with error code `ambiguous` and lists each match with its
ID and path. Where a parent is expected, `root` means the top level.

## Commands

| Command | What it does |
| --- | --- |
| `datasets` | List the datasets in the data folder, marking the one open in the app. |
| `init [--dataset NAME \| --file FILE] [--force] [--format instance\|store] [--pin PIN]` | Create an empty dataset: in the data folder with `--dataset`, or a standalone file. |
| `info` | Card, tag, bookmark and plugin counts. |
| `list [--parent ID\|root] [--tag TAG] [--include-body]` | Direct children of a card (default: root cards). |
| `tree [ID] [--depth N]` | The hierarchy as a tree. |
| `show ID` | One card: body, tags, children, outgoing links, backlinks, related cards. |
| `create TITLE [--parent ID] [--body TEXT \| --body-file FILE \| --body-stdin] [--tag TAG]... [--index N]` | Create a card. |
| `update ID [--title T] [--body … \| --body-file … \| --body-stdin] [--append] [--rich-text true\|false]` | Change a card. |
| `delete ID` | Permanently delete a card and all of its descendants. |
| `move ID [--parent ID\|root] [--index N]` | Move under a new parent and/or change position among siblings. |
| `duplicate ID [--with-children]` | Copy a card, optionally with its whole subtree. |
| `search QUERY [--tag TAG]... [--limit N] [--include-body]` | Search titles, bodies and tags. Every term must match. |
| `tag add\|remove\|set\|list ID [TAG...]` | Manage one card's tags. |
| `tags` | Every tag with the number of cards using it. |
| `links ID` | Outgoing `[[links]]`, backlinks and cards sharing tags. |
| `bookmark add\|remove ID`, `bookmark list` | Manage bookmarks. |
| `export [--format json\|md\|txt\|outline\|csv] [--card ID] [--out FILE]` | Export everything or one subtree. Prints to stdout unless `--out` is given. |
| `import FILE\|- [--parent ID\|root] [--format json\|outline]` | Merge a JSON backup, or an indented outline (2 spaces per level), into the dataset. |
| `validate [--fix]` | Check that parents, children and root order agree. Exits 1 if there are problems; `--fix` repairs them. |
| `commands` | List every command; with `--json`, a machine-readable command list. |

### Behavior notes

- **Tags** are stored in lowercase without `#`, the same as in the app. As in
  the app, inline `#hashtags` in a body are not copied into the card's tags.
- **Renames** rewrite `[[Old Title]]` links in other cards, but only when the
  old title belonged to this card alone. This is the app's rule.
- **`--body`** is stored exactly as given. For multi-line text, use
  `--body-stdin` or `--body-file FILE` (`-` reads stdin).
- **`--append`** adds the new text after a blank line.
- **`delete`** cannot be undone. The app's Trash is not stored in the file.
  Use `--dry-run` to see what would be removed, or keep a copy of the file.
- **`import`** gives imported cards new IDs, as the app's Import JSON does.
  Plugins in an imported backup are ignored.
- Writes go to a temporary file that is then renamed over the original, so
  an interrupted write cannot leave a half-written file.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. |
| 1 | The command failed (see the error code), or `validate` found problems. |
| 2 | Usage error: unknown command, missing argument or bad flag. |

Error codes in JSON output include `not_found`, `ambiguous`, `exists`,
`invalid_file`, `invalid_move`, `pin_required`, `pin_invalid`,
`schema_unsupported`, `read_failed`, `write_failed`, `folder_not_found`,
`folder_unavailable`, `dataset_required` and `usage`.

## Examples

```bash
cardspoke init --dataset "Notes"          # or: export CARDSPOKE_FILE=~/notes.json; cardspoke init
export CARDSPOKE_DATASET="Notes"
cardspoke create "Projects" --tag work
cardspoke create "CLI launch" --parent Projects --body "Ship notes, see [[Projects]]"
printf 'Line one\nLine two\n' | cardspoke update "CLI launch" --body-stdin --append
cardspoke tree
cardspoke search launch --tag work --json
cardspoke move "CLI launch" --parent root --index 0
cardspoke export --format md --out notes.md
```

## Using the CLI from an AI agent

- Always pass `--json` and check `ok` before reading `data`.
- Run `cardspoke commands --json` once to get the command list, and
  `cardspoke datasets --json` to see which datasets exist.
- Pass `--dataset` explicitly. Without it, commands go to whichever
  dataset the user last opened in the desktop app.
- Use the IDs returned by `create`, `list`, `tree` and `search` in later
  commands. Titles can change or repeat.
- Run `--dry-run` before `delete` or a large `import` to see what will change.
- Run `cardspoke validate --json` after a batch of edits.
- Set `CARDSPOKE_FILE` (and `CARDSPOKE_PIN` if needed) in the environment
  instead of repeating them on every command.

## Limits

- The CLI does not run plugins, middleware hooks, or the app's undo history.
  Plugin data on cards (`modsData`) and other unknown fields are preserved.
- It edits the desktop app's data folder, not the web app's browser storage.
  For the web app, use export and import as described above.
- The CLI does not lock the file, so do not run two writing commands on the
  same file at the same time. The desktop app may run alongside it: it
  reloads files the CLI changes.
- The CLI does not delete datasets. Delete one in the app (its file is moved
  to `.trash/`), or delete the file yourself.
