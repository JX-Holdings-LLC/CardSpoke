let query = '', tag = '', prefix = '', preview = [];
// History is session-local: card IDs can overlap across datasets. A reload
// deliberately discards undo instead of applying it to an unrelated dataset.
let history = [];
await start('Batch Workbench', async () => [
  h('p', {}, 'Preview matching cards, apply title prefixes and tags, then undo only cards unchanged since this batch. Maximum 100 cards; undo is available until reload or suspend.'),
  row([field('Title contains', query, value => { query = value; }),
    field('Add tag', tag, value => { tag = value; }), field('Title prefix', prefix, value => { prefix = value; })]),
  row([button('Preview changes', async () => {
    if (!tag.trim() && !prefix) throw new Error('Enter a tag or title prefix.');
    const cards = (await ctx.api.data.listCards()).filter(card => includes(card.title, query));
    if (cards.length > 100) throw new Error('More than 100 matches. Narrow the title filter.');
    preview = cards.map(card => ({ id: card.id, before: cardSignature(card), oldTitle: card.title,
      oldTags: tagsOf(card), title: prefix + card.title,
      tags: [...new Set([...tagsOf(card), ...tag.toLowerCase().split(',').map(t => t.trim()).filter(Boolean)])] }));
    notice = preview.length + ' changes ready. Review below.'; await paint();
  }), button('Apply preview', async () => {
    if (!preview.length) throw new Error('Preview changes first.');
    const candidates = preview;
    preview = []; history = [];
    let skipped = 0;
    for (const item of candidates) {
      const current = await ctx.api.data.getCard(item.id);
      if (!current || cardSignature(current) !== item.before) { skipped++; continue; }
      const updated = await ctx.api.data.updateCard(item.id, { title: item.title, tags: item.tags });
      if (!updated || updated.title !== item.title || JSON.stringify(tagsOf(updated)) !== JSON.stringify(item.tags))
        throw new Error('Card update did not complete; previous changes can be undone.');
      history.push({ ...item, after: cardSignature(updated) });
    }
    notice = history.length + ' updated; ' + skipped + ' changed cards skipped.'; await paint();
  }), button('Undo last batch', async () => {
    let restored = 0, skipped = 0;
    const remaining = [];
    for (const item of history) {
      const current = await ctx.api.data.getCard(item.id);
      if (!current || cardSignature(current) !== item.after) { skipped++; remaining.push(item); continue; }
      await ctx.api.data.updateCard(item.id, { title: item.oldTitle, tags: item.oldTags }); restored++;
    }
    history = remaining; notice = restored + ' restored; ' + skipped + ' changed cards skipped.'; await paint();
  }, !history.length)]),
  ...preview.map(item => box([h('strong', {}, item.oldTitle + ' → ' + item.title), h('p', {}, item.tags.join(', '))]))
]);
