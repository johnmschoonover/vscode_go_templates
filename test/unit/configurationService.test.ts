import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationService } from '../../src/services/configurationService';
import { __test } from '../__mocks__/vscode';

const ROOT = '/ws';
const CONFIG_PATH = '/ws/.vscode/goTemplateStudio.json';

const DEFAULTS = {
  templateRoots: ['templates'],
  contextDirs: ['context'],
  defaultContext: {},
};

async function load(): Promise<ConfigurationService> {
  const service = new ConfigurationService();
  await service.initialize();
  return service;
}

describe('ConfigurationService', () => {
  beforeEach(() => {
    __test.reset();
    __test.setWorkspaceRoot(ROOT);
  });

  it('returns defaults before initialization', () => {
    expect(new ConfigurationService().getConfiguration()).toEqual(DEFAULTS);
  });

  it('uses defaults when there is no workspace folder and registers no watcher', async () => {
    __test.setWorkspaceRoot(undefined);

    const service = await load();

    expect(service.getConfiguration()).toEqual(DEFAULTS);
    expect(__test.watchers).toHaveLength(0);
  });

  it('uses defaults when .vscode/goTemplateStudio.json is absent', async () => {
    const service = await load();

    expect(service.getConfiguration()).toEqual(DEFAULTS);
  });

  it('parses templateRoots, contextDirs and defaultContext from the config file', async () => {
    __test.writeFile(
      CONFIG_PATH,
      JSON.stringify({
        templateRoots: ['views', 'emails'],
        contextDirs: ['fixtures', 'data/ctx'],
        defaultContext: { 'views/home.tmpl': 'fixtures/home.json' },
      })
    );

    const service = await load();

    expect(service.getConfiguration()).toEqual({
      templateRoots: ['views', 'emails'],
      contextDirs: ['fixtures', 'data/ctx'],
      defaultContext: { 'views/home.tmpl': 'fixtures/home.json' },
    });
  });

  it('fills in defaults for keys missing from a partial config', async () => {
    __test.writeFile(CONFIG_PATH, JSON.stringify({ contextDirs: ['fixtures'] }));

    const config = (await load()).getConfiguration();

    expect(config.contextDirs).toEqual(['fixtures']);
    expect(config.templateRoots).toEqual(['templates']);
    expect(config.defaultContext).toEqual({});
  });

  it('falls back to defaults for empty arrays and wrongly typed values', async () => {
    __test.writeFile(
      CONFIG_PATH,
      JSON.stringify({ templateRoots: [], contextDirs: 'context', defaultContext: null })
    );

    expect((await load()).getConfiguration()).toEqual(DEFAULTS);
  });

  it('falls back to defaults on malformed JSON instead of throwing', async () => {
    __test.writeFile(CONFIG_PATH, '{ "contextDirs": [ "oops", ');

    const service = await load();

    expect(service.getConfiguration()).toEqual(DEFAULTS);
  });

  it('does not share mutable default state between instances', async () => {
    const first = (await load()).getConfiguration();
    first.templateRoots.push('mutated');
    first.defaultContext['x'] = 'y';

    const second = (await load()).getConfiguration();

    expect(second).toEqual(DEFAULTS);
  });

  it('watches .vscode/goTemplateStudio.json under the workspace folder', async () => {
    await load();

    expect(__test.watchers).toHaveLength(1);
    expect(__test.watchers[0].__pattern.base).toBe(ROOT);
    expect(__test.watchers[0].__pattern.pattern).toBe('.vscode/goTemplateStudio.json');
  });

  it('reloads and fires onDidChangeConfiguration when the file changes', async () => {
    const service = await load();
    const listener = vi.fn();
    service.onDidChangeConfiguration(listener);

    __test.writeFile(CONFIG_PATH, JSON.stringify({ contextDirs: ['fresh'] }));
    __test.watchers[0].__fire('create');
    // loadConfiguration is async and fire-and-forget from the watcher.
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));

    expect(listener.mock.calls[0][0].contextDirs).toEqual(['fresh']);
    expect(service.getConfiguration().contextDirs).toEqual(['fresh']);
  });

  it('reverts to defaults when the config file is deleted', async () => {
    __test.writeFile(CONFIG_PATH, JSON.stringify({ contextDirs: ['fixtures'] }));
    const service = await load();
    expect(service.getConfiguration().contextDirs).toEqual(['fixtures']);
    const listener = vi.fn();
    service.onDidChangeConfiguration(listener);

    __test.removeFile(CONFIG_PATH);
    __test.watchers[0].__fire('delete');
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());

    expect(service.getConfiguration()).toEqual(DEFAULTS);
  });

  it('disposes its watcher', async () => {
    const service = await load();

    service.dispose();

    expect(__test.watchers[0].__disposed).toBe(true);
  });
});
