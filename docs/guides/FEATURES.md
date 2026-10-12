# CardSpoke Feature Guide

Everything CardSpoke 0.21.1 (Public Preview) can do, and where to find it. Open the menu with the ☰ button in the top right.

## Cards

Every note in CardSpoke is a card with a title, a body and optional tags. A card can hold other cards.

- **New card:** menu → **New Card**, or `Ctrl+N`. Click **Save** when you're done.
- **Card inside a card:** open a card and click **Add Child**. Nest as deep as you like.
- **Move and reorder:** drag cards in the list, or move a card under a different parent.
- **Duplicate:** **Duplicate** (or `Ctrl+D`) copies a card, with or without the cards inside it.
- **Share:** **Share** copies a card to the clipboard as Markdown or JSON, ready to paste elsewhere. It does not send anything over the internet.
- **Bring in text:** **Import TXT** on a card adds a text file to its body or turns an indented outline into child cards.
- **Breadcrumbs:** the trail at the top shows where you are and takes you back up.

## Links between cards

- Write `[[Card Title]]` in a card's body to link to another card.
- Clicking a link to a card that doesn't exist yet offers to create it.
- **Referenced By** on every card lists the cards that link to it.
- **Related Cards** lists cards that share tags with the one you're reading.

## Tags, bookmarks and recent cards

- Add tags while editing a card. Click a tag to see every card that has it.
- **Suggest Tags** proposes tags based on similar cards.
- **Tag Manager** (menu) renames, merges or deletes a tag across all cards.
- Click ☆ **Bookmark** on a card to star it. **Bookmarks** (`Ctrl+B`) and **Recent Cards** (`Ctrl+R`) are in the menu.

## Search

- Press `Ctrl+F` or click the search box. Search forgives typos and looks through titles, text and tags.
- Use the arrow keys to move through results and Enter to open one.
- Choose **Current** or **All** to search this collection or every collection.
- **Advanced Search** (menu) filters by tag, by bookmark, or by date (today, last 7 days, last 30 days).

## Editing and recovery

- **Rich Text** (Appearance) turns on Markdown-style formatting and a toolbar for bold, italic, headings and lists.
- **Undo and redo** with `Ctrl+Z` and `Ctrl+Y`, or the undo button in the header.
- **Trash Bin** (menu) keeps deleted cards until you restore them or delete them for good.
- The save indicator shows when your changes are safely saved on this device.

## Your collections (datasets)

A dataset is a separate collection of cards with its own storage. Open menu → **Data & Export** → **Manage Datasets**.

- **Create, open and delete** datasets. Searching **All** looks across them.
- **Choose where a dataset is stored:** browser storage, a larger browser database (IndexedDB), or a file you pick on your own disk.
- **Lock with a PIN.** A PIN-protected dataset is encrypted on disk with AES-GCM. There is no way to recover it without the PIN. A short PIN keeps out casual snooping, not a determined attacker.
- **Desktop data folder.** In the desktop app, each dataset is a plain JSON file in a folder you choose (default `Documents/CardSpoke`). Change it under **File → Change Data Folder…**. Edits made to those files by other tools, such as the [command-line tool](./CLI.md), appear in the app automatically.

## Backups and export

Open menu → **Data & Export**.

| Button | What you get | Use it to |
| --- | --- | --- |
| **Backup (JSON)** | Everything in the dataset: cards, tags, bookmarks, theme and plugins | Restore later, or move to another device or browser |
| **Markdown** | One document with a heading per card, nested by depth | Read or edit in another notes app |
| **CSV** | One row per card | Open in a spreadsheet |
| **Plain Text** | An indented outline | Paste anywhere |

- A PIN-protected dataset can be backed up **encrypted**; you'll need the PIN to import it. Markdown, CSV and plain-text copies are never encrypted, and CardSpoke warns you before writing one.
- **Upload** (menu, or `Ctrl+U`) imports a JSON backup, or turns a text file or indented outline into cards.

## Appearance and accessibility

Open menu → **Appearance**.

- **Light and dark mode:** the theme button in the header, or `Alt+T`.
- **Views:** default list, **Grid View** (`Ctrl+G`) and **Compact View** (`Alt+C`).
- **High Contrast** for easier reading.
- **Typography presets:** Default, Comfortable, Compact and Dyslexia-Friendly.
- **Theme plugins** such as Forest, Cyberpunk and Monochrome, from the plugin gallery.
- Dialogs keep keyboard focus inside them and return it when they close. Animations are reduced when your system asks for reduced motion.

## Keyboard shortcuts

Press `Ctrl+/` in the app to see them all. On a Mac, use `Cmd` for `Ctrl` and `Option` for `Alt`.

| Shortcut | Action |
| --- | --- |
| `Ctrl+N` | New card |
| `Ctrl+F` | Search |
| `Ctrl+H` | Home |
| `Ctrl+B` | Bookmarks |
| `Ctrl+R` | Recent cards |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+D` | Duplicate the current card |
| `Ctrl+T` | Jump to the tags field while editing |
| `Ctrl+G` | Toggle grid view |
| `Ctrl+[` / `Ctrl+]` | Go to the parent / first child card |
| `Ctrl+E` | Plugin Manager |
| `Ctrl+U` | Upload |
| `Alt+T` | Light / dark mode |
| `Alt+C` | Compact view |
| `Escape` | Close a dialog or go back |

## Plugins

Plugins add to CardSpoke without making the default app heavier. Open menu → **Plugin Manager** (`Ctrl+E`).

- **Gallery:** browse curated themes and features, such as Kanban Board, Daily Journal, Pomodoro Desk, Card Color Tags and Card Reading Time.
- **Install:** from a JSON file, or from a URL hosted on GitHub.
- **Create:** write a plugin right in the app with metadata, JavaScript and CSS.
- **Installed:** turn plugins on and off, or remove them. Removing a plugin cleans up everything it added.

There are three kinds of plugin:

- **Theme** plugins only change colors and styles. They contain no code.
- **Feature** plugins add panels, buttons and behavior.
- **App** plugins can reshape the app itself, for example by renaming it or replacing parts of the interface.

Feature and App plugins run their code in a separate worker and can only use the permissions you approve. CardSpoke asks before running any plugin code, and labels each plugin with its risk level. An enabled plugin can still read your unlocked cards, so only enable plugins from authors you trust.

If a plugin causes trouble, add `?safemode` to the end of the address (in the browser) to start CardSpoke with every plugin turned off.

**Writing your own?** Start with the [Plugin Authoring Guide](./PLUGIN_AUTHORING_GUIDE.md), then the [sample plugins](../../sample-plugins/) and the [Plugin API reference](../api/PLUGIN_API.md).

## Command-line tool

The [CardSpoke CLI](./CLI.md) reads and edits datasets from a terminal: list, search, create, move, tag and export cards. Every command can print JSON, so scripts and AI agents can use it. It works on the desktop app's data folder (even while the app is open) or on any exported backup, and it never uses the network.

## Privacy

- No account and no analytics. Your cards are saved on your device.
- CardSpoke only goes online when you browse the plugin gallery or install a plugin by URL, and those requests contain no card data.
- The browser version keeps cards in that browser. Clearing the browser's site data deletes them, so download a backup regularly.

Details: [Storage & Privacy](../policies/STORAGE_AND_PRIVACY.md) and [Security & Safety](../policies/SECURITY_AND_SAFETY.md).

## Not in this version

- Sync between devices, cloud storage or real-time collaboration. Move cards between devices with a backup.
- Published mobile apps. The browser version works on phones and tablets.
- Translations into other languages.

## For maintainers

Storage keys, the store shape and schema rules are documented in the [Schema Reference](../api/SCHEMA_REFERENCE.md) and [Storage Model](../api/STORAGE_DRIVER_INTERFACE.md). Community rules for forks and derivative apps are in the [Deviation Guide](./DEVIATION_GUIDE.md).
