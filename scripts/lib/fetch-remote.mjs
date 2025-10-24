import { execFile } from 'node:child_process';

function runCurl(url) {
  return new Promise((resolve, reject) => {
    execFile('curl', ['-fsSL', url], { encoding: null }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(Buffer.from(stdout));
    });
  });
}

export async function fetchRemoteResource(url, label = 'resource') {
  if (typeof fetch === 'function') {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download ${label} from ${url}: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      if (error && typeof error === 'object' && 'cause' in error) {
        const { cause } = error;
        if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENETUNREACH') {
          return runCurl(url);
        }
      }

      throw error;
    }
  }

  return runCurl(url);
}
