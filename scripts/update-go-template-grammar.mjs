import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRemoteResource } from './lib/fetch-remote.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const resources = [
  {
    url: 'https://raw.githubusercontent.com/jinliming2/vscode-go-template/master/syntaxes/go-template.tmLanguage.json',
    destination: path.join(repoRoot, 'syntaxes', 'go-template.tmLanguage.json'),
    label: 'TextMate grammar',
  },
  {
    url: 'https://raw.githubusercontent.com/jinliming2/vscode-go-template/master/LICENSE',
    destination: path.join(repoRoot, 'third_party', 'licenses', 'jinliming2-vscode-go-template', 'LICENSE'),
    label: 'license',
  },
];

async function download({ url, destination, label }) {
  const data = await fetchRemoteResource(url, label);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, data);
  console.log(`Updated ${label} → ${path.relative(repoRoot, destination)}`);
}

try {
  await Promise.all(resources.map(download));
  console.log('Grammar assets refreshed successfully.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
