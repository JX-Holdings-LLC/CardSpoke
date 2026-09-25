// Deterministic packaging: readable source -> independently installable JSON.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = resolve(root, 'sample-plugins/advanced');
const read = name => readFileSync(resolve(base, 'src', name), 'utf8').replace(/\r\n/g, '\n');
export const catalog = [
  ['paper-atlas', 'Paper Atlas', 'theme', 'Editorial palettes, reading rhythm, adaptive cards and print layout.'],
  ['nocturne-console', 'Nocturne Console', 'theme', 'Analytical grid surfaces, code styling and keyboard navigation accents.'],
  ['clear-harbor', 'Clear Harbor', 'theme', 'Calm, large-target interface with light/dark, motion and forced-color rules.'],
  ['knowledge-audit', 'Knowledge Audit', 'feature', 'Find duplicate titles, empty cards, broken and ambiguous links; decorate card tiles.'],
  ['smart-collections', 'Smart Collections', 'feature', 'Save and reload compound text/tag filters with sorting and bounded result lists.'],
  ['batch-workbench', 'Batch Workbench', 'feature', 'Preview bulk title/tag edits and undo with conflict checks.'],
  ['project-planner', 'Project Planner', 'app', 'Project trees, task boards, dependencies, deadlines and completion tracking.'],
  ['study-studio', 'Study Studio', 'app', 'Flashcards, answer reveal, spaced repetition, due queues and review statistics.'],
  ['research-desk', 'Research Desk', 'app', 'Deduplicated sources, annotated excerpts and repeatable synthesis cards.']
];
const check = process.argv.includes('--check');
const output = (path, value) => {
  const content = JSON.stringify(value, null, 2) + '\n';
  if (check) {
    if (readFileSync(path, 'utf8').replace(/\r\n/g, '\n') !== content) throw new Error('Rebuild advanced packages: ' + path);
  } else writeFileSync(path, content);
};
for (const [short, name, layer, description] of catalog) {
  const id = 'lab-' + short;
  const dir = resolve(base, layer === 'app' ? 'apps' : layer + 's');
  mkdirSync(dir, { recursive: true });
  const permissions = layer === 'theme' ? [] : ['ui-override'];
  if (['knowledge-audit', 'smart-collections'].includes(short)) permissions.push('storage');
  if (layer === 'app' || short === 'batch-workbench') permissions.push('data-modify');
  const pkg = { id, manifest: { id, name, version: '1.0.0', author: 'CardSpoke Community', description, layer,
    permissions, compatibility: '>=0.21.1', ...(short === 'smart-collections' ? { config: { maxResults: 100 } } : {}) },
    css: layer === 'theme' ? read(short + '.css') + '\n' + read('theme-controls.css') : read('shared.css') };
  if (layer !== 'theme') pkg.js = read('shared.js') + '\n' + read(short + '.js');
  output(resolve(dir, short + '.json'), pkg);
}
output(resolve(base, 'manifest.json'), { version: '1.0.0', plugins: catalog.map(([id, name, layer, description]) => ({
  id: 'lab-' + id, name, description, layer,
  file: (layer === 'app' ? 'apps' : layer + 's') + '/' + id + '.json'
})) });
console.log(check ? 'Nine advanced packages match their source.' : 'Built nine advanced plugin packages.');
