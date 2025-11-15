import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRemoteResource } from './lib/fetch-remote.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const resources = [
  {
    url: 'https://raw.githubusercontent.com/jinliming2/vscode-go-template/master/syntaxes/go-template.tmLanguage.json',
    localPath: path.join(repoRoot, 'syntaxes', 'go-template.tmLanguage.json'),
    label: 'TextMate grammar',
  },
  {
    url: 'https://raw.githubusercontent.com/jinliming2/vscode-go-template/master/LICENSE',
    localPath: path.join(repoRoot, 'third_party', 'licenses', 'jinliming2-vscode-go-template', 'LICENSE'),
    label: 'license',
  },
];

function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

let isOutOfDate = false;

for (const resource of resources) {
  try {
    const [remoteContent, localContent] = await Promise.all([
      fetchRemoteResource(resource.url, resource.label),
      readFile(resource.localPath),
    ]);

    const remoteHash = hashBuffer(remoteContent);
    const localHash = hashBuffer(localContent);

    if (remoteHash !== localHash) {
      console.error(
        `${resource.label} is outdated. Local SHA ${localHash} differs from upstream SHA ${remoteHash}.`,
      );
      isOutOfDate = true;
    } else {
      console.log(`${resource.label} is up to date.`);
    }
  } catch (error) {
    console.error(`Failed to verify ${resource.label}:`, error);
    isOutOfDate = true;
  }
}

if (isOutOfDate) {
  console.error('Go template grammar assets are out of date. Run "npm run update:grammar" and commit the refreshed files.');
  process.exitCode = 1;
} else {
  console.log('Go template grammar assets are current.');
}
