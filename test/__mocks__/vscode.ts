/**
 * Lightweight stand-in for the `vscode` module, aliased in vitest.config.ts
 * (and in tsconfig.test.json for type checking).
 *
 * Only the surface used by the unit-tested modules is implemented
 * (diagnosticService, configurationService, contextManager,
 * contextAssociationManager). Extend it as new modules come under test.
 *
 * Shared state (virtual filesystem, workspace folders, watchers, diagnostic
 * collections) is exposed through the `__test` helper object; call
 * `__test.reset()` from `beforeEach`.
 */
import * as nodePath from 'path';

// --- Uri ---------------------------------------------------------------

export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query = '',
    public readonly fragment = ''
  ) {}

  public static file(fsPath: string): Uri {
    const normalized = fsPath.replace(/\\/g, '/');
    return new Uri('file', '', normalized.startsWith('/') ? normalized : `/${normalized}`);
  }

  public static parse(value: string): Uri {
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value);
    if (!match) {
      return new Uri('file', '', value);
    }
    return new Uri(match[1], match[2] ?? '', decodeURIComponent(match[3] ?? ''), match[4] ?? '', match[5] ?? '');
  }

  public static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, base.authority, nodePath.posix.join(base.path, ...segments), base.query, base.fragment);
  }

  public get fsPath(): string {
    return this.path;
  }

  public toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }
}

// --- Positions / ranges / diagnostics ----------------------------------

export class Position {
  public constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
  public readonly start: Position;
  public readonly end: Position;

  public constructor(start: Position, end: Position) {
    this.start = start;
    this.end = end;
  }
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Diagnostic {
  public source?: string;

  public constructor(
    public range: Range,
    public message: string,
    public severity: DiagnosticSeverity = DiagnosticSeverity.Error
  ) {}
}

// --- Events / disposables ----------------------------------------------

export class Disposable {
  public constructor(private readonly callOnDispose: () => void) {}

  public dispose(): void {
    this.callOnDispose();
  }
}

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];

  public readonly event = (listener: (e: T) => void): Disposable => {
    this.listeners.push(listener);
    return new Disposable(() => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    });
  };

  public fire(data: T): void {
    for (const listener of [...this.listeners]) {
      listener(data);
    }
  }

  public dispose(): void {
    this.listeners = [];
  }
}

// --- Filesystem --------------------------------------------------------

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export interface WorkspaceFolder {
  readonly uri: Uri;
  readonly name: string;
  readonly index: number;
}

export class RelativePattern {
  public readonly base: string;

  public constructor(base: WorkspaceFolder | Uri | string, public readonly pattern: string) {
    this.base = typeof base === 'string' ? base : base instanceof Uri ? base.fsPath : base.uri.fsPath;
  }
}

export interface MockFileSystemWatcher {
  onDidChange(listener: () => void): Disposable;
  onDidCreate(listener: () => void): Disposable;
  onDidDelete(listener: () => void): Disposable;
  dispose(): void;
  /** Test helper: simulate a file event. */
  __fire(kind: 'change' | 'create' | 'delete'): void;
  readonly __pattern: RelativePattern;
  readonly __disposed: boolean;
}

/** Virtual filesystem: absolute posix path -> file contents, or `null` for a directory. */
const virtualFiles = new Map<string, string | null>();
const watchers: MockFileSystemWatcher[] = [];

function fileNotFound(uri: Uri): Error {
  const error = new Error(`EntryNotFound (FileSystemError): ${uri.path}`);
  error.name = 'EntryNotFound (FileSystemError)';
  return error;
}

const fs = {
  async readFile(uri: Uri): Promise<Buffer> {
    const content = virtualFiles.get(uri.path);
    if (typeof content !== 'string') {
      throw fileNotFound(uri);
    }
    return Buffer.from(content, 'utf8');
  },

  async stat(uri: Uri): Promise<{ type: FileType; ctime: number; mtime: number; size: number }> {
    if (!virtualFiles.has(uri.path)) {
      throw fileNotFound(uri);
    }
    const type = virtualFiles.get(uri.path) === null ? FileType.Directory : FileType.File;
    return { type, ctime: 0, mtime: 0, size: 0 };
  },

  async readDirectory(uri: Uri): Promise<Array<[string, FileType]>> {
    const prefix = uri.path.endsWith('/') ? uri.path : `${uri.path}/`;
    const children = new Map<string, FileType>();
    for (const [filePath, content] of virtualFiles) {
      if (!filePath.startsWith(prefix)) {
        continue;
      }
      const [name, ...remaining] = filePath.slice(prefix.length).split('/');
      if (!name) {
        continue;
      }
      if (remaining.length > 0) {
        children.set(name, FileType.Directory);
      } else if (!children.has(name)) {
        children.set(name, content === null ? FileType.Directory : FileType.File);
      }
    }
    return [...children.entries()];
  },
};

// --- Workspace ---------------------------------------------------------

const configurationValues = new Map<string, unknown>();
let workspaceFolderList: WorkspaceFolder[] | undefined;

export const workspace = {
  get workspaceFolders(): WorkspaceFolder[] | undefined {
    return workspaceFolderList;
  },

  fs,

  getConfiguration(section?: string) {
    return {
      get<T>(key: string, defaultValue?: T): T | undefined {
        const fullKey = section ? `${section}.${key}` : key;
        return configurationValues.has(fullKey) ? (configurationValues.get(fullKey) as T) : defaultValue;
      },
    };
  },

  /** Workspace-relative path; returns the input path unchanged when outside the workspace. */
  asRelativePath(pathOrUri: string | Uri, _includeWorkspaceFolder?: boolean): string {
    const target = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.path;
    const root = workspaceFolderList?.[0]?.uri.path;
    if (root && target.startsWith(`${root}/`)) {
      return target.slice(root.length + 1);
    }
    return target;
  },

  createFileSystemWatcher(pattern: RelativePattern): MockFileSystemWatcher {
    const handlers: Record<'change' | 'create' | 'delete', Array<() => void>> = {
      change: [],
      create: [],
      delete: [],
    };
    let disposed = false;
    const register = (kind: 'change' | 'create' | 'delete') => (listener: () => void) => {
      handlers[kind].push(listener);
      return new Disposable(() => {
        handlers[kind] = handlers[kind].filter((l) => l !== listener);
      });
    };
    const watcher: MockFileSystemWatcher = {
      onDidChange: register('change'),
      onDidCreate: register('create'),
      onDidDelete: register('delete'),
      dispose: () => {
        disposed = true;
      },
      __fire: (kind) => handlers[kind].forEach((handler) => handler()),
      __pattern: pattern,
      get __disposed() {
        return disposed;
      },
    };
    watchers.push(watcher);
    return watcher;
  },
};

// --- Languages / diagnostic collection ---------------------------------

export class MockDiagnosticCollection {
  public readonly entries = new Map<string, Diagnostic[]>();
  public disposed = false;

  public constructor(public readonly name: string) {}

  public set(uri: Uri, diagnostics: Diagnostic[]): void {
    this.entries.set(uri.toString(), diagnostics);
  }

  public delete(uri: Uri): void {
    this.entries.delete(uri.toString());
  }

  public clear(): void {
    this.entries.clear();
  }

  public get(uri: Uri): Diagnostic[] | undefined {
    return this.entries.get(uri.toString());
  }

  public dispose(): void {
    this.disposed = true;
    this.entries.clear();
  }
}

const diagnosticCollections: MockDiagnosticCollection[] = [];

export const languages = {
  createDiagnosticCollection(name: string): MockDiagnosticCollection {
    const collection = new MockDiagnosticCollection(name);
    diagnosticCollections.push(collection);
    return collection;
  },
};

// --- Window ------------------------------------------------------------

export interface MockOutputChannel {
  readonly name: string;
  readonly lines: string[];
  appendLine(line: string): void;
  append(value: string): void;
  show(): void;
  dispose(): void;
}

export const window = {
  createOutputChannel(name: string): MockOutputChannel {
    const lines: string[] = [];
    return {
      name,
      lines,
      appendLine: (line: string) => {
        lines.push(line);
      },
      append: (value: string) => {
        lines.push(value);
      },
      show: () => undefined,
      dispose: () => undefined,
    };
  },
};

// --- Test helpers (not part of the real vscode API) --------------------

export const __test = {
  /** Reset all shared mock state. Call from `beforeEach`. */
  reset(): void {
    virtualFiles.clear();
    watchers.length = 0;
    diagnosticCollections.length = 0;
    configurationValues.clear();
    workspaceFolderList = undefined;
  },

  setWorkspaceRoot(fsPath: string | undefined): void {
    workspaceFolderList = fsPath ? [{ uri: Uri.file(fsPath), name: nodePath.posix.basename(fsPath), index: 0 }] : undefined;
  },

  /** Seed a file; parent directories are created implicitly. */
  writeFile(fsPath: string, content: string): void {
    const filePath = Uri.file(fsPath).path;
    virtualFiles.set(filePath, content);
    __test.mkdir(nodePath.posix.dirname(filePath));
  },

  mkdir(fsPath: string): void {
    let current = Uri.file(fsPath).path;
    while (current && current !== '/' && !virtualFiles.has(current)) {
      virtualFiles.set(current, null);
      current = nodePath.posix.dirname(current);
    }
  },

  removeFile(fsPath: string): void {
    virtualFiles.delete(Uri.file(fsPath).path);
  },

  setConfigurationValue(key: string, value: unknown): void {
    configurationValues.set(key, value);
  },

  get watchers(): readonly MockFileSystemWatcher[] {
    return watchers;
  },

  get diagnosticCollections(): readonly MockDiagnosticCollection[] {
    return diagnosticCollections;
  },
};
