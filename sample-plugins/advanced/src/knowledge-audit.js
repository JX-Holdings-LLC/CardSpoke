const settings = await readState('settings', { onlyIssues: true });
let findings = new Map();
const nameKey = value => text(value).trim().toLowerCase().replace(/\s+/g, ' ');
function audit(cards) {
  const byTitle = new Map();
  cards.forEach(card => {
    const key = nameKey(card.title);
    byTitle.set(key, [...(byTitle.get(key) || []), card]);
  });
  findings = new Map(cards.map(card => {
    const issues = [];
    if (!text(card.body).trim()) issues.push('Empty body');
    if ((byTitle.get(nameKey(card.title)) || []).length > 1) issues.push('Duplicate title');
    for (const match of text(card.body).matchAll(/\[\[([^\]]+)\]\]/g)) {
      const targets = byTitle.get(nameKey(match[1])) || [];
      if (!targets.length) issues.push('Missing link: ' + match[1]);
      else if (targets.length > 1) issues.push('Ambiguous link: ' + match[1]);
    }
    return [card.id, [...new Set(issues)]];
  }));
}
audit(await ctx.api.data.listCards());
const decorate = ctx.api.middleware.register({ name: 'audit-badge', operations: ['card.render'], handler: card => {
  const issues = findings.get(card.id) || [];
  return issues.length ? { appendChildren: { '.card-content': [h('span', {
    className: 'lab-audit-badge', title: issues.join('; ')
  }, issues.length + ' audit issue' + (issues.length === 1 ? '' : 's'))] } } : null;
} });
await decorate.ready;
await start('Knowledge Audit', async () => {
  const cards = await ctx.api.data.listCards();
  audit(cards);
  const problemCount = [...findings.values()].filter(issues => issues.length).length;
  return [
    h('p', {}, cards.length + ' cards · ' + problemCount + ' with issues. Read-only analysis; no cards are modified.'),
    button(settings.onlyIssues ? 'Show all cards' : 'Show issues only', async () => {
      settings.onlyIssues = !settings.onlyIssues;
      await writeState('settings', settings); await paint();
    }),
    ...cards.filter(card => !settings.onlyIssues || findings.get(card.id).length).slice(0, 200).map(card => box([
      h('strong', {}, title(card)), h('p', {}, findings.get(card.id).join(' · ') || 'No issues')
    ])), h('small', {}, 'At most 200 results displayed. Refresh reruns the audit and updates the next tile render.')
  ];
});
