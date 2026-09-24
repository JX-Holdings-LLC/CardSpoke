let sourceTitle = '', sourceUrl = '', sourceId = '', excerpt = '', note = '';
const info = card => card.modsData && card.modsData[ctx.modId] || {};
await start('Research Desk', async () => {
  const cards = await ctx.api.data.listCards();
  const sources = cards.filter(card => tagsOf(card).includes('lab-source'));
  if (!sources.some(card => card.id === sourceId)) sourceId = sources[0]?.id || '';
  const selected = sources.find(card => card.id === sourceId);
  const extracts = cards.filter(card => card.parentId === sourceId && tagsOf(card).includes('lab-excerpt'));
  return [
    h('p', {}, 'Store citations and excerpts locally. URLs are recorded as text; this plugin does not fetch pages.'),
    row([field('Source title', sourceTitle, value => { sourceTitle = value; }), field('Source URL', sourceUrl, value => { sourceUrl = value; }),
      button('Add source', async () => {
        if (!sourceTitle.trim()) throw new Error('Enter a source title.');
        const url = new URL(sourceUrl);
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Use an http or https source URL.');
        const fresh = await ctx.api.data.listCards();
        if (fresh.some(card => tagsOf(card).includes('lab-source') && info(card).url === url.href)) throw new Error('This URL is already in your sources.');
        sourceId = await ctx.api.data.createCard({ title: sourceTitle.trim(), body: 'Source: ' + url.href, tags: ['lab-source'] });
        await ctx.api.data.updateCard(sourceId, { modsData: { [ctx.modId]: { schema: 1, url: url.href } } });
        sourceTitle = ''; sourceUrl = ''; await paint();
      })]),
    row([select('Source', sourceId, sources.map(card => [card.id, title(card)]), value => { sourceId = value; }), button('Open source', paint)]),
    selected ? h('p', {}, info(selected).url || selected.body) : h('p', {}, 'Add a source to begin.'),
    row([field('Excerpt', excerpt, value => { excerpt = value; }, 'textarea'), field('Your note', note, value => { note = value; }, 'textarea'),
      button('Save excerpt', async () => {
        const parent = sourceId && await ctx.api.data.getCard(sourceId);
        if (!parent || !excerpt.trim()) throw new Error('Choose a source and enter an excerpt.');
        await ctx.api.data.createCard({ title: excerpt.trim().slice(0, 70), body: excerpt.trim() + '\n\nNote: ' + note.trim() + '\n\nSource: [[' + parent.title + ']]',
          parentId: sourceId, tags: ['lab-excerpt'] }); excerpt = ''; note = ''; await paint();
      }), button('Build synthesis card', async () => {
        const parent = sourceId && await ctx.api.data.getCard(sourceId);
        if (!parent) throw new Error('Choose a source.');
        const all = await ctx.api.data.listCards();
        const items = all.filter(card => card.parentId === sourceId && tagsOf(card).includes('lab-excerpt'));
        if (!items.length) throw new Error('Save at least one excerpt first.');
        const body = 'Research synthesis: [[' + parent.title + ']]\n\n' + items.map(card => '## ' + card.title + '\n' + card.body).join('\n\n');
        const existing = all.find(card => card.parentId === sourceId && tagsOf(card).includes('lab-synthesis'));
        if (existing) await ctx.api.data.updateCard(existing.id, { body });
        else await ctx.api.data.createCard({ title: 'Synthesis — ' + parent.title, body, parentId: sourceId, tags: ['lab-synthesis'] });
        notice = 'Synthesis saved (' + items.length + ' excerpts). Rebuilding updates the same card.'; await paint();
      })]),
    h('p', {}, extracts.length + ' excerpts'), ...extracts.slice(0, 100).map(card => box([h('strong', {}, title(card)), h('p', {}, card.body)]))
  ];
});
