# CardSpoke CLI

**Status:** current (experimental) · **Applies to:** 0.21.1, schema v4

The CardSpoke CLI edits CardSpoke data from a terminal. It is built for
scripts and AI agents: every command can print JSON, errors exit non-zero
with a stable error code, and the CLI never uses the network.

It runs the same headless card engine as the app (`www/src/kernel.js`), so
cards created or changed by the CLI follow the app's rules for IDs, tags,
hierarchy and `[[links]]`.

## What the CLI works on

CardSpoke keeps its data in the browser or desktop app's storage, which a
terminal cannot reach. The CLI works on a **CardSpoke JSON file** instead:

| File | Where it comes from | How the app reads it back |
| --- | --- | --- |
| Instance backup (`exportType: "instance"`) | **Export JSON** in the app, or `cardspoke init` | **Import JSON** in the app |
| Raw dataset payload (`rootOrder`) | A dataset using the local-file storage driver | Loaded on the app's next start |

Both can be PIN-encrypted. The CLI saves a file in the same format and
encryption it was loaded with.

A typical round trip:

1. In the app, export the dataset as JSON.
2. Edit the file with the CLI (or let an AI agent do it).
3. Import the file in the app.

For a local-file dataset, close the app before editing its file. The CLI
updates `metadata.persistedAt`, so the app treats the CLI's copy as the
newest version when it next starts.

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
| `--file FILE`, `-f FILE` | Dataset file. Default: `$CARDSPOKE_FILE`, else `./cardspoke.json`. |
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
| `init [--force] [--format instance\|store] [--pin PIN]` | Create an empty dataset file. |
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
`schema_unsupported`, `read_failed`, `write_failed` and `usage`.

## Examples

```bash
export CARDSPOKE_FILE=~/notes/cardspoke.json
cardspoke init
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
- Run `cardspoke commands --json` once to get the command list.
- Use the IDs returned by `create`, `list`, `tree` and `search` in later
  commands. Titles can change or repeat.
- Run `--dry-run` before `delete` or a large `import` to see what will change.
- Run `cardspoke validate --json` after a batch of edits.
- Set `CARDSPOKE_FILE` (and `CARDSPOKE_PIN` if needed) in the environment
  instead of repeating them on every command.

## Limits

- The CLI does not run plugins, middleware hooks, or the app's undo history.
  Plugin data on cards (`modsData`) and other unknown fields are preserved.
- It does not edit the app's live browser storage. Use export and import as
  described above.
- The CLI does not lock the file, so do not run two writing commands on the
  same file at the same time.
