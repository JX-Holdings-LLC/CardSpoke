let collections = await readState('collections', []);
if (!Array.isArray(collections)) collections = [];
let query = '', tag = '', name = '', sort = 'title';
let selected = '';
await start('Smart Collections', async () => {
  const cards = (await ctx.api.data.listCards()).filter(card =>
    includes(card.title + '\n' + card.body, query) && (!tag.trim() || tagsOf(card).includes(tag.trim().toLowerCase())));
  cards.sort((a, b) => sort === 'recent' ? (b.updatedAt || 0) - (a.updatedAt || 0) : title(a).localeCompare(title(b)));
  return [
    row([field('Collection name', name, value => { name = value; }), field('Contains text', query, value => { query = value; }),
      field('Required tag', tag, value => { tag = value; }),
      select('Sort', sort, [['title', 'Title'], ['recent', 'Recently updated']], value => { sort = value; })]),
    row([button('Apply filter', paint), button('Save collection', async () => {
      if (!name.trim()) throw new Error('Enter a collection name.');
      const entry = { name: name.trim(), query, tag, sort };
      collections = collections.filter(item => item.name !== entry.name).concat(entry).slice(-50);
      selected = entry.name;
      await writeState('collections', collections); notice = 'Collection saved.'; await paint();
    })]),
    row([select('Saved collection', selected, [['', 'Choose a collection'], ...collections.map(item => [item.name, item.name])], value => { selected = value; }),
      button('Load collection', async () => {
        const entry = collections.find(item => item.name === selected);
        if (!entry) throw new Error('Choose a saved collection.');
        ({ name, query, tag, sort } = entry); await paint();
      }), button('Delete collection', async () => {
        collections = collections.filter(item => item.name !== selected);
        selected = ''; await writeState('collections', collections); await paint();
      })]),
    h('p', {}, cards.length + ' matching cards'),
    ...cards.slice(0, number(ctx.config.maxResults, 100, 1, 500)).map(card => box([
      h('strong', {}, title(card)), h('p', {}, text(card.body).slice(0, 240)), h('small', {}, tagsOf(card).join(', '))
    ]))
  ];
});
