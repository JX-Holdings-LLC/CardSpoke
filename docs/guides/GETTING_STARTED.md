# Your first ten minutes with CardSpoke

This walkthrough takes you from an empty notebook to a small linked tree of cards, then shows you how to keep it safe. Nothing here needs an account, and nothing leaves your device.

Open CardSpoke in your browser at [jx-holdings-llc.github.io/CardSpoke](https://jx-holdings-llc.github.io/CardSpoke/), or use the desktop app. Open the menu with the ☰ button in the top right whenever a step mentions it.

## 1. Make your first card

1. Open the menu and choose **New Card**, or press `Ctrl+N` (`Cmd+N` on a Mac).
2. Give it a title, such as `Trip to Lisbon`, and write a few lines in the body.
3. Click **Save**. The save indicator confirms your card is stored on this device.

## 2. Put cards inside cards

1. Open `Trip to Lisbon` and click **Add Child**.
2. Create a card called `Packing list`. It now sits inside the trip.
3. Add another child called `Things to see`.

The breadcrumbs at the top show where you are. Click any of them to go back up. Drag a card in the list to reorder it or move it under a different parent.

## 3. Link cards together

1. Edit `Things to see` and write `Book a table before [[Packing list]]`.
2. Save, then open `Packing list`. The **Referenced By** section lists `Things to see`, so the connection shows from both sides.
3. Write a link to a card that doesn't exist yet, such as `[[Hotel]]`. Clicking it offers to create the card.

## 4. Find things again

Press `Ctrl+F` and type a word from any card. Search forgives typos and looks through titles, text and tags. Add a few tags while editing, then try **Advanced Search** in the menu to narrow by tag, bookmark or date.

## 5. Keep it safe

- **Back up.** Open menu → **Data & Export** and choose **Backup (JSON)**. In the browser, your cards live in that browser, so clearing site data deletes them. Back up regularly.
- **Lock it, if you want to.** In **Manage Datasets** you can protect a collection with a PIN. It is then encrypted on disk, and nobody can recover it without the PIN, including you.
- **Undo mistakes.** `Ctrl+Z` undoes, and **Trash Bin** in the menu restores deleted cards.

## Where to go next

- [Feature Guide](./FEATURES.md): everything CardSpoke can do, and where to find it.
- [Storage & Privacy](../policies/STORAGE_AND_PRIVACY.md): exactly where your cards live.
- [Plugin Manager](./FEATURES.md#plugins): themes and extras such as a Kanban board or daily journal.
- [Command-line tool](./CLI.md): for scripting and automation, if you want it.
