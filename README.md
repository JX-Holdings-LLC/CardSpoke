# CardSpoke

![CardSpoke logo](./CardSpoke.svg)

**Your notes, as cards, kept on your device.**

CardSpoke is a private, local-first notebook where every note is a card. A card can hold other cards, so a novel, a research project or a recipe collection grows into a tree you can walk through. Link any card to another by writing its title in double brackets, and CardSpoke shows the connection from both sides.

There is no account to create and no cloud to trust. Your cards are saved on your device, you can lock a collection with a PIN, and you can take everything with you whenever you like.

**[Open CardSpoke in your browser](https://jx-holdings-llc.github.io/CardSpoke/)** · [Desktop app](#get-cardspoke) · [Build a plugin](#build-plugins)

*Public Preview 0.21.1. Free and open source under the Apache License 2.0.*

## Get CardSpoke

| Where | How |
| --- | --- |
| **Browser** | Open [jx-holdings-llc.github.io/CardSpoke](https://jx-holdings-llc.github.io/CardSpoke/). After the first visit it also works offline. Your cards stay in that browser on that device. |
| **Windows, macOS, Linux** | Installers will be on the [Releases page](https://github.com/JX-Holdings-LLC/CardSpoke/releases) with the first desktop release. Until then you can build the app yourself with the [Desktop guide](./docs/guides/DESKTOP.md). The desktop app saves each collection as a plain file in a folder you choose. |
| **Phones and tablets** | The browser version adapts to small screens. Native mobile apps are experimental and not yet published. |

## What you can do

### Give your notes shape

- Put cards inside cards, as deep as you need. Breadcrumbs always show the way back.
- Write `[[Card Title]]` to link to another card. Every card lists the cards that link to it. Clicking a link to a card that doesn't exist yet offers to create it.
- Add tags, see related cards that share them, and rename or merge tags across everything at once.
- Bookmark the cards you use most. Recent cards are one click away.
- Drag cards to reorder them or move them under a different parent.

### Find anything

- Search forgives typos and looks through titles, text and tags.
- Narrow results by tag, bookmark or date with Advanced Search.
- Search the current collection or all of them at once.

### Keep it private

- **No account, no server.** Your cards are saved on your device and CardSpoke does not upload them anywhere.
- **Separate collections.** Keep work, personal and creative projects in their own datasets, each with its own storage.
- **PIN protection.** Lock a dataset with a PIN and it is encrypted on disk (AES-GCM). Without the PIN, nobody can read it, including you, so remember it.
- **Plain files on desktop.** The desktop app keeps each dataset as a readable JSON file in a folder you pick, so you can back it up with the tools you already use.

### Take it with you

- Download a **JSON backup** that restores everything: cards, tags, bookmarks, themes and plugins. A PIN-protected dataset can be backed up encrypted.
- Download a readable copy as **Markdown**, **CSV** or **plain text** for other apps.
- Import a backup, or paste in an indented outline and CardSpoke turns it into cards.

### Write comfortably

- Formatting toolbar with Markdown-style rich text.
- Undo and redo, and a trash bin that lets you restore deleted cards.
- List, grid and compact views.
- Light and dark modes, high contrast, and reading presets including a dyslexia-friendly one.
- Keyboard shortcuts for almost everything. Press `Ctrl+/` to see them.

### Make it yours

- Install themes from the built-in plugin gallery, such as Forest, Cyberpunk and Monochrome.
- Add features such as a Kanban board, a daily journal or a Pomodoro timer.
- Use the [command-line tool](./docs/guides/CLI.md) to read and edit your cards from scripts or AI agents. It works on the desktop app's data folder, even while the app is open, and never touches the network.

## Your data and privacy

CardSpoke saves your cards on your device and does not collect analytics. It only goes online when you ask it to, such as when you browse the plugin gallery. That request contains no card data.

A few things are worth knowing:

- **Plugins can read your cards.** Plugin code runs in a separate, permission-checked worker, and CardSpoke asks before running any. An enabled plugin can still read your unlocked cards, so only enable plugins from authors you trust. If something goes wrong, open CardSpoke with `?safemode` at the end of the address to start with all plugins off.
- **Readable copies aren't encrypted.** Markdown, CSV and plain-text copies of a PIN-protected dataset are readable by anyone who gets the file. CardSpoke warns you before writing one.
- **The browser version lives in the browser.** Clearing your browser's site data deletes cards stored there. Download a backup regularly.

The full details are in [Storage & Privacy](./docs/policies/STORAGE_AND_PRIVACY.md) and [Security & Safety](./docs/policies/SECURITY_AND_SAFETY.md).

## Build plugins

CardSpoke stays small by default and grows through plugins. There are three kinds:

| Kind | What it can do | How it runs |
| --- | --- | --- |
| **Theme** | Restyle the app with CSS | No code. Turns on when installed. |
| **Feature** | Add panels, buttons, card decorations and behavior | JavaScript in a worker, with the permissions the user approves |
| **App** | Reshape the app: intercept saves, replace components, even rename it | Same worker model, turned on by the user |

You can write a plugin as a single JSON file, test it in the app's **Plugin Manager → Create** tab, and share it as a JSON file. The browser version can also install a plugin from a URL hosted on GitHub.

- [Plugin Authoring Guide](./docs/guides/PLUGIN_AUTHORING_GUIDE.md): start here. It covers the package format, the `ctx` API, permissions and testing.
- [Sample plugins](./sample-plugins/) and [nine advanced examples](./sample-plugins/advanced/README.md) to copy from.
- [Plugin API reference](./docs/api/PLUGIN_API.md), [middleware hooks](./docs/api/MIDDLEWARE_PIPELINE.md) and [component overrides](./docs/api/COMPONENT_REGISTRY.md).
- [TypeScript definitions](./types/README.md) for editor autocomplete.

## What's not here yet

CardSpoke is a public preview. It does not currently offer:

- Sync between devices, cloud storage or real-time collaboration. To move cards between devices, export a backup and import it on the other one.
- Published mobile apps.
- Translations into other languages.

## Help and feedback

- In the app, open the menu (☰) and choose **Getting Started** or **Help & Documentation**.
- Found a bug or have an idea? [Open an issue](https://github.com/JX-Holdings-LLC/CardSpoke/issues).
- See what changed in each release in the [changelog](./CHANGELOG.md).

## Working on CardSpoke itself

To build CardSpoke from source, run the tests or package the desktop and mobile apps, see the [Developer Guide](./docs/guides/DEVELOPER_GUIDE.md) and [Contributing](./CONTRIBUTING.md). The [documentation home](./docs/README.md) maps everything else.

## Credits

CardSpoke is created by [Jeffrey Guntly](https://github.com/jxburros) and maintained by [JX Holdings, LLC](https://jxholdings.com). Licensed under the [Apache License 2.0](./LICENSE).
