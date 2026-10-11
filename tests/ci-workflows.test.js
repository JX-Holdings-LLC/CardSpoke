import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { readFileSync, readdirSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const workflowDir = './.github/workflows';
const workflows = readdirSync(workflowDir)
  .filter(name => /\.ya?ml$/.test(name))
  .map(name => ({ name, text: readFileSync(`${workflowDir}/${name}`, 'utf8') }));

test('Playwright CI image matches the pinned playwright package', () => {
  // The image's preinstalled browsers only work with the same playwright
  // version; a mismatch fails browser QA with "Executable doesn't exist".
  const expected = pkg.devDependencies.playwright;
  assert.ok(/^\d+\.\d+\.\d+$/.test(expected), 'playwright must be pinned to an exact version');
  const images = workflows.flatMap(({ name, text }) =>
    [...text.matchAll(/mcr\.microsoft\.com\/playwright:v([\d.]+)/g)].map(m => ({ name, version: m[1] })));
  assert.ok(images.length > 0, 'Expected browser QA to run in the Playwright image');
  for (const { name, version } of images) {
    assert.is(version, expected, `${name} uses Playwright image v${version}, package.json pins ${expected}`);
  }
});

test('browser QA never relies on sudo-installed system libraries', () => {
  // The self-hosted runner has no passwordless sudo, so --with-deps fails.
  for (const { name, text } of workflows) {
    assert.not.ok(/playwright install[^\n]*--with-deps/.test(text), `${name} uses playwright install --with-deps`);
  }
});

test.run();
