# Quickstart

Use this guide to render templates quickly with the Go Template Studio extension.

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

For additional context on renderer behavior and troubleshooting, review the [README](../README.md) and supporting documents in the repository root.
