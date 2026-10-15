# Quickstart

Use this guide to render templates quickly with the Go Template Studio extension.

## Sample Templates

The repository ships sample templates in `templates/` with matching context files in `context/`. Open one, run **Go Template Studio: Preview Template**, and pick the context with the same base name:

- `deployment.yaml.tmpl` + `deployment.yaml`: a YAML context rendered into a Kubernetes manifest with `range` and `{{- -}}` whitespace control (a text template, so the preview shows Text).
- `welcome.html.tmpl` + `welcome.toml`: an HTML email from a TOML context. The `.html` before `.tmpl` turns on `html/template`, so a `<script>` tag in the context shows as escaped text.
- `report.go.tmpl` + `report.json`: nested JSON with `with`, `range $k, $v`, a `define`d block, `printf`, and the helpers below.
- `asdf.go.tmpl` + `asdf.json` and `inline.go.tmpl` (no context) are the minimal starters.

The [README](../README.md#sample-assets) describes what each sample demonstrates.

## Built-in Template Helpers

The bundled Go renderer automatically registers a helper map for every template render. You can call these helpers without importing additional packages or preparing a context file.

### Collection Constructors
- `list` creates ordered collections: `{{$items := list "alpha" "beta"}}`.
- `dict` and `map` build string-keyed maps inline: `{{$config := dict "title" "Docs" "items" $items}}`.

These helpers let you assemble ad-hoc data directly inside your template. Combine them with control structures like `range` to iterate without authoring a JSON context file.

### String and Formatting Utilities
Common transformations are also ready to use:

```gotemplate
{{ "go" | upper }}
{{ "GO" | lower }}
{{ "go template studio" | title }}
{{ "  spaced  " | trim }}
{{ "value" | default "fallback" }}
{{ list "a" "b" | join ", " }}
{{ "<strong>safe</strong>" | safe }}
{{ "<em>escaped</em>" | escape }}
```

The helpers work in both text and HTML templates. Pair them with the **Render without context** command to iterate rapidly when you only need inline data.

## Reference Data

Context files hold the data your template renders with. Put them in a `context/` folder (or any directory listed in `contextDirs` in `.vscode/goTemplateStudio.json`) as `.json`, `.yaml`/`.yml`, or `.toml`. They appear in the **Go Template Contexts** view in the Explorer.

For example, `context/welcome.yaml`:

```yaml
Title: Welcome aboard
Site:
  Owner:
    Name: Gopher
Items:
  - Read the quickstart
  - Preview a template
```

A template can then read nested values the same way it would from JSON:

```gotemplate
<h1>{{ .Title }}</h1>
<p>Maintained by {{ .Site.Owner.Name }}</p>
<ul>{{ range .Items }}<li>{{ . }}</li>{{ end }}</ul>
```

- Click **+** in the view title (or run **Go Template Studio: Create Context File**) to create a starter file. Type a name ending in `.yaml`, `.yml`, or `.toml` to pick that format, or leave off the extension to get JSON.
- Right-click a context to open, duplicate, or delete it. Deleted files go to the trash.
- Run **Go Template Studio: Select Context** with a template open to choose which context the preview uses.
- If the file has a syntax error, the preview reports it on the context file. YAML and TOML errors include the line number.

For additional context on renderer behavior and troubleshooting, review the [README](../README.md) and supporting documents in the repository root.
