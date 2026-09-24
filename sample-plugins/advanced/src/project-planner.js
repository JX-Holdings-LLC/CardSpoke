let projectName = '', taskName = '', selected = '', due = '', depends = '';
const metadata = card => card.modsData && card.modsData[ctx.modId] || {};
const taskStatus = card => metadata(card).status || 'todo';
async function patchTask(id, changes) {
  const fresh = await ctx.api.data.getCard(id);
  if (!fresh) throw new Error('This task was deleted. Refresh the planner.');
  return ctx.api.data.updateCard(id, { modsData: { ...fresh.modsData, [ctx.modId]: { ...metadata(fresh), ...changes, schema: 1 } } });
}
await start('Project Planner', async () => {
  const cards = await ctx.api.data.listCards();
  const projects = cards.filter(card => tagsOf(card).includes('lab-project'));
  if (!projects.some(card => card.id === selected)) selected = projects[0]?.id || '';
  const tasks = cards.filter(card => card.parentId === selected && tagsOf(card).includes('lab-task'));
  const complete = tasks.filter(card => taskStatus(card) === 'done').length;
  return [
    row([field('New project', projectName, value => { projectName = value; }), button('Create project', async () => {
      if (!projectName.trim()) throw new Error('Enter a project name.');
      selected = await ctx.api.data.createCard({ title: projectName.trim(), body: 'Project workspace', tags: ['lab-project'] });
      projectName = ''; await paint();
    })]),
    row([select('Project', selected, projects.map(card => [card.id, title(card)]), value => { selected = value; depends = ''; }), button('Open project', paint)]),
    h('p', {}, complete + '/' + tasks.length + ' tasks complete'),
    h('progress', { value: complete, max: Math.max(1, tasks.length), 'aria-label': 'Project completion' }),
    row([field('Task title', taskName, value => { taskName = value; }), field('Due date', due, value => { due = value; }, 'date'),
      select('Depends on', depends, [['', 'No dependency'], ...tasks.map(card => [card.id, title(card)])], value => { depends = value; }),
      button('Add task', async () => {
        if (!selected || !taskName.trim()) throw new Error('Choose a project and enter a task title.');
        const parent = await ctx.api.data.getCard(selected);
        if (!parent) throw new Error('The project was deleted. Refresh.');
        const dependency = depends && await ctx.api.data.getCard(depends);
        if (depends && (!dependency || dependency.parentId !== selected)) throw new Error('Choose a dependency in this project.');
        const id = await ctx.api.data.createCard({ title: taskName.trim(), parentId: selected, tags: ['lab-task'] });
        await patchTask(id, { status: 'todo', due, depends }); taskName = ''; due = ''; depends = ''; await paint();
      })]),
    h('div', { className: 'lab-columns' }, ['todo', 'doing', 'done'].map(status => box([
      h('h3', {}, status.toUpperCase()), ...tasks.filter(card => taskStatus(card) === status).map(card => {
        const info = metadata(card);
        const dependency = cards.find(candidate => candidate.id === info.depends);
        const blocked = info.depends && (!dependency || taskStatus(dependency) !== 'done');
        const overdue = info.due && info.due < new Date().toLocaleDateString('en-CA') && status !== 'done';
        return box([h('strong', {}, title(card)), h('p', {}, (info.due ? 'Due ' + info.due : 'No due date') + (overdue ? ' · Overdue' : '') +
          (blocked ? ' · Blocked by ' + (dependency ? title(dependency) : 'a missing task') : '')),
          row(['todo', 'doing', 'done'].filter(next => next !== status).map(next => button('Move to ' + next, async () => {
            const fresh = await ctx.api.data.getCard(card.id);
            if (!fresh) throw new Error('Task no longer exists.');
            const depId = metadata(fresh).depends;
            const dep = depId && await ctx.api.data.getCard(depId);
            if (next !== 'todo' && depId && (!dep || taskStatus(dep) !== 'done')) throw new Error('Complete the dependency first.');
            await patchTask(card.id, { status: next }); await paint();
          })))
        ]);
      })
    ])))
  ];
});
