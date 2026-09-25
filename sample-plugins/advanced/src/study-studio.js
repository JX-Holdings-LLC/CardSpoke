let front = '', back = '', revealed = false;
let activeId = null;
const meta = card => card.modsData && card.modsData[ctx.modId] || {};
async function grade(id, good) {
  const card = await ctx.api.data.getCard(id);
  if (!card) throw new Error('Study card no longer exists.');
  const state = meta(card);
  // Re-check due time to make rapid duplicate rating clicks idempotent.
  if ((state.due || 0) > Date.now()) return;
  const interval = good ? Math.min(365, Math.max(1, (state.interval || 0) * 2)) : 0;
  const next = { schema: 1, interval, due: Date.now() + (good ? interval * 86400000 : 60000),
    reviews: (state.reviews || 0) + 1, lapses: (state.lapses || 0) + (good ? 0 : 1) };
  await ctx.api.data.updateCard(id, { modsData: { ...card.modsData, [ctx.modId]: next } });
  revealed = false; activeId = null; notice = good ? 'Scheduled in ' + interval + ' day(s).' : 'Try again in one minute.';
  await paint();
}
await start('Study Studio', async () => {
  const cards = (await ctx.api.data.listCards()).filter(card => tagsOf(card).includes('lab-study'));
  const dueCards = cards.filter(card => (meta(card).due || 0) <= Date.now()).sort((a, b) => (meta(a).due || 0) - (meta(b).due || 0));
  const current = dueCards.find(card => card.id === activeId) || dueCards[0];
  if (current?.id !== activeId) { activeId = current?.id || null; revealed = false; }
  const reviews = cards.reduce((sum, card) => sum + (meta(card).reviews || 0), 0);
  return [
    h('p', {}, cards.length + ' study cards · ' + dueCards.length + ' due · ' + reviews + ' reviews'),
    row([field('Question', front, value => { front = value; }), field('Answer', back, value => { back = value; }, 'textarea'),
      button('Create study card', async () => {
        if (!front.trim() || !back.trim()) throw new Error('Enter both a question and an answer.');
        await ctx.api.data.createCard({ title: front.trim(), body: back.trim(), tags: ['lab-study'] }); front = ''; back = ''; await paint();
      })]),
    current ? box([h('h3', {}, title(current)), revealed ? h('p', { className: 'lab-answer' }, current.body) : h('p', {}, 'Recall the answer before revealing it.'),
      row([button('Reveal answer', async () => { revealed = true; await paint(); }, revealed),
        button('Again', () => grade(current.id, false), !revealed), button('Good', () => grade(current.id, true), !revealed)])]) : h('p', {}, 'All caught up. Refresh when the next card is due.'),
    ...cards.slice(0, 100).map(card => box([h('strong', {}, title(card)), h('small', {}, ' · ' + (meta(card).reviews || 0) + ' reviews · ' +
      (meta(card).due ? 'Next: ' + new Date(meta(card).due).toLocaleString() : 'Ready now')),
      button('Reset schedule', async () => {
        const fresh = await ctx.api.data.getCard(card.id);
        if (!fresh) throw new Error('Card no longer exists.');
        await ctx.api.data.updateCard(card.id, { modsData: { ...fresh.modsData, [ctx.modId]: { schema: 1, due: 0, interval: 0, reviews: 0, lapses: 0 } } });
        revealed = false; await paint();
      })]))
  ];
});
