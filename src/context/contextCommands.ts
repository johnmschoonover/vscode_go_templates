import * as path from 'path';
import * as vscode from 'vscode';
import { ContextAssociationManager } from './contextAssociationManager';
import {
  CONTEXT_FORMAT_LABELS,
  ContextDescriptor,
  ContextFormat,
  ContextStore,
  SUPPORTED_CONTEXT_EXTENSIONS,
  contextFormatFromFileName,
} from './contextManager';
import { ContextTreeItem } from './contextTreeDataProvider';

export interface ContextCommandDependencies {
  readonly contextStore: ContextStore;
  readonly associationManager: ContextAssociationManager;
  readonly output: vscode.OutputChannel;
  /** Invoked after a newly created context is associated with a template (e.g. to re-render the preview). */
  readonly onDidAssociate?: (templateUri: vscode.Uri, descriptor: ContextDescriptor) => Promise<void> | void;
  /**
   * Invoked after a context file was deleted and its template associations were cleared (e.g. to switch
   * open previews that rendered with it to no context).
   */
  readonly onDidDelete?: (descriptor: ContextDescriptor) => Promise<void> | void;
}

const DEFAULT_CONTEXT_EXTENSION = '.json';
const TEMPLATE_LANGUAGE_IDS = new Set(['go-templates', 'gotemplate']);
const TEMPLATE_EXTENSIONS = new Set(['.tmpl', '.tpl', '.gotmpl']);

// TODO(schema-hints): PRD 5.1 item 2 calls for schema hints when editing context files.
// Generate or associate a JSON schema (and YAML/TOML equivalents) for starter documents once
// the schema story is defined; out of scope for the initial CRUD commands.
const STARTER_CONTENT: Readonly<Record<ContextFormat, string>> = {
  json: '{\n  "Title": "Hello",\n  "Items": ["first", "second"]\n}\n',
  yaml: [
    '# Sample Go Template Studio context. Reference values as {{ .Title }} or {{ range .Items }}.',
    'Title: Hello',
    'Items:',
    '  - first',
    '  - second',
    '',
  ].join('\n'),
  toml: [
    '# Sample Go Template Studio context. Reference values as {{ .Title }} or {{ range .Items }}.',
    'Title = "Hello"',
    'Items = ["first", "second"]',
    '',
  ].join('\n'),
};

/**
 * Registers create/duplicate/delete commands for context files and returns their disposables.
 * Commands invoked from the context explorer receive a `ContextTreeItem`; from the command
 * palette they fall back to a quick pick of known contexts.
 */
export function registerContextCommands(deps: ContextCommandDependencies): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('goTemplateStudio.createContext', () => createContext(deps)),
    vscode.commands.registerCommand('goTemplateStudio.duplicateContext', (target?: unknown) =>
      duplicateContext(deps, target)
    ),
    vscode.commands.registerCommand('goTemplateStudio.deleteContext', (target?: unknown) =>
      deleteContext(deps, target)
    ),
  ];
}

/**
 * Resolves a command argument (tree item, Uri, or nothing) to a known context descriptor,
 * prompting with a quick pick when no usable argument was provided.
 */
export async function resolveContextTarget(
  contextStore: ContextStore,
  target: unknown,
  placeHolder: string
): Promise<ContextDescriptor | undefined> {
  if (target instanceof ContextTreeItem) {
    return target.descriptor;
  }

  if (target instanceof vscode.Uri) {
    return (
      contextStore.findByUri(target) ?? {
        uri: target,
        label: path.basename(target.fsPath, path.extname(target.fsPath)),
        relativePath: vscode.workspace.asRelativePath(target, false),
        format: contextFormatFromFileName(target.fsPath) ?? 'json',
      }
    );
  }

  const contexts = contextStore.getContexts();
  if (contexts.length === 0) {
    void vscode.window.showInformationMessage('No context files found. Create one with "Create Context File".');
    return undefined;
  }

  const pick = await vscode.window.showQuickPick(
    contexts.map((descriptor) => ({
      label: descriptor.label,
      description: descriptor.relativePath,
      detail: CONTEXT_FORMAT_LABELS[descriptor.format],
      descriptor,
    })),
    { placeHolder }
  );

  return pick?.descriptor;
}

async function createContext(deps: ContextCommandDependencies): Promise<void> {
  const { contextStore, output } = deps;
  // Capture the template editor before we open the new context file and steal focus.
  const templateEditor = getTemplateEditor();

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showWarningMessage('Open a workspace folder before creating a context file.');
    return;
  }

  const directory = await pickContextDirectory(contextStore.getContextDirectories());
  if (!directory) {
    return;
  }

  const directoryUri = vscode.Uri.joinPath(folder.uri, directory);
  const fileName = await promptForFileName({
    prompt: `Name for the new context file in ${directory}/ (JSON, YAML, or TOML)`,
    value: 'sample.json',
    defaultExtension: DEFAULT_CONTEXT_EXTENSION,
    directoryUri,
  });
  if (!fileName) {
    return;
  }

  if (!(await ensureDirectory(directoryUri, directory, folder, output))) {
    return;
  }

  const format = contextFormatFromFileName(fileName) ?? 'json';
  const fileUri = vscode.Uri.joinPath(directoryUri, fileName);

  try {
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(STARTER_CONTENT[format], 'utf8'));
  } catch (error) {
    reportFailure(output, `Failed to create ${fileName}`, error);
    return;
  }

  output.appendLine(`[context] Created ${vscode.workspace.asRelativePath(fileUri, false)}`);
  await contextStore.refresh();
  await openContext(fileUri);

  if (templateEditor) {
    await offerAssociation(deps, templateEditor.document.uri, fileUri);
  }
}

async function duplicateContext(deps: ContextCommandDependencies, target: unknown): Promise<void> {
  const { contextStore, output } = deps;
  const source = await resolveContextTarget(contextStore, target, 'Select a context file to duplicate');
  if (!source) {
    return;
  }

  const sourceExtension = path.extname(source.uri.path);
  const directoryUri = vscode.Uri.joinPath(source.uri, '..');
  const suggestedName = await suggestCopyName(directoryUri, source.label, sourceExtension);

  const fileName = await promptForFileName({
    prompt: `Name for the copy of ${source.relativePath}`,
    value: suggestedName,
    defaultExtension: sourceExtension,
    directoryUri,
    requiredFormat: source.format,
  });
  if (!fileName) {
    return;
  }

  const targetUri = vscode.Uri.joinPath(directoryUri, fileName);
  try {
    await vscode.workspace.fs.copy(source.uri, targetUri, { overwrite: false });
  } catch (error) {
    reportFailure(output, `Failed to duplicate ${source.relativePath}`, error);
    return;
  }

  output.appendLine(
    `[context] Duplicated ${source.relativePath} -> ${vscode.workspace.asRelativePath(targetUri, false)}`
  );
  await contextStore.refresh();
  await openContext(targetUri);
}

async function deleteContext(deps: ContextCommandDependencies, target: unknown): Promise<void> {
  const { contextStore, output } = deps;
  const descriptor = await resolveContextTarget(contextStore, target, 'Select a context file to delete');
  if (!descriptor) {
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Delete context file "${descriptor.relativePath}"?`,
    { modal: true, detail: 'The file will be moved to the trash.' },
    'Move to Trash'
  );
  if (confirmation !== 'Move to Trash') {
    return;
  }

  try {
    await vscode.workspace.fs.delete(descriptor.uri, { useTrash: true, recursive: false });
  } catch (error) {
    reportFailure(output, `Failed to delete ${descriptor.relativePath}`, error);
    return;
  }

  output.appendLine(`[context] Moved ${descriptor.relativePath} to trash`);
  // Detach the deleted file from templates (status bar reads "No context") and from open previews.
  // TODO(context-associations): the persisted defaultContext entries in .vscode/goTemplateStudio.json
  // are not rewritten; prune them once associations are written back to settings.
  deps.associationManager.clearContext(descriptor);
  await contextStore.refresh();
  await deps.onDidDelete?.(descriptor);
}

function getTemplateEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const { document } = editor;
  if (TEMPLATE_LANGUAGE_IDS.has(document.languageId)) {
    return editor;
  }

  return TEMPLATE_EXTENSIONS.has(path.extname(document.uri.path).toLowerCase()) ? editor : undefined;
}

async function pickContextDirectory(directories: string[]): Promise<string | undefined> {
  // ConfigurationService falls back to ['context'], but guard against an empty list anyway.
  const candidates = directories.length > 0 ? directories : ['context'];
  if (candidates.length === 1) {
    return candidates[0];
  }

  const pick = await vscode.window.showQuickPick(
    candidates.map((directory, index) => ({
      label: directory,
      description: index === 0 ? 'default' : undefined,
    })),
    { placeHolder: 'Select a context directory for the new file' }
  );

  return pick?.label;
}

async function ensureDirectory(
  directoryUri: vscode.Uri,
  directory: string,
  folder: vscode.WorkspaceFolder,
  output: vscode.OutputChannel
): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(directoryUri);
    if (stat.type & vscode.FileType.Directory) {
      return true;
    }

    void vscode.window.showErrorMessage(`${directory} exists but is not a folder.`);
    return false;
  } catch {
    // Directory is missing; offer to create it below.
  }

  const choice = await vscode.window.showInformationMessage(
    `The context folder "${directory}/" does not exist in ${folder.name}. Create it?`,
    'Create Folder'
  );
  if (choice !== 'Create Folder') {
    return false;
  }

  try {
    await vscode.workspace.fs.createDirectory(directoryUri);
  } catch (error) {
    reportFailure(output, `Failed to create the context folder ${directory}/`, error);
    return false;
  }
  return true;
}

interface FileNamePromptOptions {
  readonly prompt: string;
  readonly value: string;
  readonly defaultExtension: string;
  readonly directoryUri: vscode.Uri;
  /** When set, the chosen name must decode with this format (e.g. duplicates keep the source format). */
  readonly requiredFormat?: ContextFormat;
}

async function promptForFileName(options: FileNamePromptOptions): Promise<string | undefined> {
  const { prompt, value, defaultExtension, directoryUri, requiredFormat } = options;
  const extensionList = SUPPORTED_CONTEXT_EXTENSIONS.join(', ');

  const withExtension = (input: string): string => {
    const trimmed = input.trim();
    return path.extname(trimmed) ? trimmed : `${trimmed}${defaultExtension}`;
  };

  const input = await vscode.window.showInputBox({
    prompt,
    value,
    valueSelection: [0, value.length - path.extname(value).length],
    validateInput: async (raw) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        return 'Enter a file name.';
      }
      if (/[\\/]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
        return 'Enter a file name without folders.';
      }

      const candidate = withExtension(trimmed);
      const format = contextFormatFromFileName(candidate);
      if (!format) {
        return `Use one of ${extensionList} (or omit the extension for ${defaultExtension}).`;
      }
      if (requiredFormat && format !== requiredFormat) {
        return `Keep the ${CONTEXT_FORMAT_LABELS[requiredFormat]} format of the original file.`;
      }
      if (await exists(vscode.Uri.joinPath(directoryUri, candidate))) {
        return `${candidate} already exists.`;
      }

      return undefined;
    },
  });

  return input === undefined ? undefined : withExtension(input);
}

async function suggestCopyName(directoryUri: vscode.Uri, baseName: string, extension: string): Promise<string> {
  for (let attempt = 1; attempt < 100; attempt += 1) {
    const suffix = attempt === 1 ? '-copy' : `-copy-${attempt}`;
    const candidate = `${baseName}${suffix}${extension}`;
    if (!(await exists(vscode.Uri.joinPath(directoryUri, candidate)))) {
      return candidate;
    }
  }

  return `${baseName}-copy${extension}`;
}

async function offerAssociation(
  deps: ContextCommandDependencies,
  templateUri: vscode.Uri,
  contextUri: vscode.Uri
): Promise<void> {
  const descriptor = deps.contextStore.findByUri(contextUri);
  if (!descriptor) {
    return;
  }

  const templateName = path.basename(templateUri.path);
  const choice = await vscode.window.showInformationMessage(
    `Use ${descriptor.relativePath} as the context for ${templateName}?`,
    'Use for Template'
  );
  if (choice !== 'Use for Template') {
    return;
  }

  deps.associationManager.setActiveContext(templateUri, descriptor);
  await deps.onDidAssociate?.(templateUri, descriptor);
}

async function openContext(uri: vscode.Uri): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: false });
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function reportFailure(output: vscode.OutputChannel, message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  output.appendLine(`[context] ${message}: ${detail}`);
  void vscode.window.showErrorMessage(`${message}: ${detail}`);
}
