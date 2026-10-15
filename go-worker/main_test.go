package main

import (
	htmltmpl "html/template"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExecuteRequiresTemplatePath(t *testing.T) {
	resp := execute("", "")
	if resp.Error != "template path is required" {
		t.Fatalf("expected template path error, got %q", resp.Error)
	}
}

func TestExecuteRendersTemplateWithContextAndHelpers(t *testing.T) {
	dir := t.TempDir()

	templateContent := "Hello {{.name}}! {{ $list := list 1 2 }}First: {{ index $list 0 }} {{ $map := map \"language\" .lang }}Lang: {{ index $map \"language\" }}"
	templatePath := filepath.Join(dir, "welcome.tmpl")
	if err := os.WriteFile(templatePath, []byte(templateContent), 0o600); err != nil {
		t.Fatalf("failed to write template file: %v", err)
	}

	contextPath := filepath.Join(dir, "context.json")
	if err := os.WriteFile(contextPath, []byte(`{"name":"Gopher","lang":"Go"}`), 0o600); err != nil {
		t.Fatalf("failed to write context file: %v", err)
	}

	resp := execute(templatePath, contextPath)
	if resp.Error != "" {
		t.Fatalf("expected successful render, got error: %s", resp.Error)
	}

	expected := "Hello Gopher! First: 1 Lang: Go"
	if resp.Rendered != expected {
		t.Fatalf("unexpected rendered output: %q", resp.Rendered)
	}

	if len(resp.Diagnostics) != 0 {
		t.Fatalf("expected no diagnostics, got %d", len(resp.Diagnostics))
	}
}

func TestExecuteReportsTemplateErrors(t *testing.T) {
	dir := t.TempDir()

	templatePath := filepath.Join(dir, "broken.tmpl")
	if err := os.WriteFile(templatePath, []byte("{{ .Missing }"), 0o600); err != nil {
		t.Fatalf("failed to write template file: %v", err)
	}

	resp := execute(templatePath, "")
	if resp.Error == "" {
		t.Fatal("expected an error for malformed template")
	}

	if len(resp.Diagnostics) != 1 {
		t.Fatalf("expected one diagnostic entry, got %d", len(resp.Diagnostics))
	}

	if resp.Diagnostics[0].Severity != "error" {
		t.Fatalf("expected error severity, got %q", resp.Diagnostics[0].Severity)
	}

	if resp.Diagnostics[0].File != templatePath {
		t.Fatalf("expected diagnostic to target template path, got %q", resp.Diagnostics[0].File)
	}

	if resp.Diagnostics[0].Line == 0 {
		t.Fatalf("expected diagnostic line to be populated: %+v", resp.Diagnostics[0])
	}
}

func TestLoadContextBehaviors(t *testing.T) {
	t.Run("empty path", func(t *testing.T) {
		data, err := loadContext("")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		asMap, ok := data.(map[string]any)
		if !ok {
			t.Fatalf("expected map result, got %T", data)
		}

		if len(asMap) != 0 {
			t.Fatalf("expected empty map, got %v", asMap)
		}
	})

	t.Run("missing file", func(t *testing.T) {
		_, err := loadContext("/path/does/not/exist.json")
		if err == nil {
			t.Fatal("expected error when loading missing file")
		}
	})

	t.Run("parses json file", func(t *testing.T) {
		dir := t.TempDir()
		contextPath := filepath.Join(dir, "context.json")
		if err := os.WriteFile(contextPath, []byte(`{"values":[1,2]}`), 0o600); err != nil {
			t.Fatalf("failed to write context file: %v", err)
		}

		data, err := loadContext(contextPath)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		asMap := data.(map[string]any)
		if _, ok := asMap["values"]; !ok {
			t.Fatalf("expected key 'values' to be present: %v", asMap)
		}
	})
}

func TestExecuteReportsContextErrors(t *testing.T) {
	dir := t.TempDir()

	templatePath := filepath.Join(dir, "template.tmpl")
	if err := os.WriteFile(templatePath, []byte("Hello"), 0o600); err != nil {
		t.Fatalf("failed to write template file: %v", err)
	}

	contextPath := filepath.Join(dir, "context.json")
	if err := os.WriteFile(contextPath, []byte("not json"), 0o600); err != nil {
		t.Fatalf("failed to write context file: %v", err)
	}

	resp := execute(templatePath, contextPath)
	if len(resp.Diagnostics) != 1 {
		t.Fatalf("expected single diagnostic for invalid context, got %d", len(resp.Diagnostics))
	}

	diag := resp.Diagnostics[0]
	if diag.File != contextPath {
		t.Fatalf("expected diagnostic to reference context path %q, got %q", contextPath, diag.File)
	}

	if diag.Line != 0 {
		t.Fatalf("expected context diagnostic to omit line information, got %d", diag.Line)
	}
}

func TestParseContext(t *testing.T) {
	t.Run("empty content", func(t *testing.T) {
		data, err := parseContext([]byte("   \n"), contextFormatJSON)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if len(data.(map[string]any)) != 0 {
			t.Fatalf("expected empty map, got %v", data)
		}
	})

	t.Run("invalid json", func(t *testing.T) {
		_, err := parseContext([]byte("not valid"), contextFormatJSON)
		if err == nil {
			t.Fatal("expected json parsing error")
		}

		if !strings.Contains(err.Error(), "failed to parse context JSON") {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("valid json", func(t *testing.T) {
		data, err := parseContext([]byte(`{"name":"Gopher"}`), contextFormatJSON)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		asMap := data.(map[string]any)
		if asMap["name"] != "Gopher" {
			t.Fatalf("expected name to equal 'Gopher', got %v", asMap["name"])
		}
	})
}

func TestRenderTemplateSelectsEngine(t *testing.T) {
	plain, err := renderTemplate("plain.tmpl", "Plain {{.value}}", map[string]any{"value": "text"})
	if err != nil {
		t.Fatalf("unexpected error rendering text template: %v", err)
	}

	if plain != "Plain text" {
		t.Fatalf("unexpected text output: %q", plain)
	}

	html, err := renderTemplate("document.html", "<div>{{.value}}</div>", map[string]any{"value": "html"})
	if err != nil {
		t.Fatalf("unexpected error rendering html template: %v", err)
	}

	if html != "<div>html</div>" {
		t.Fatalf("unexpected html output: %q", html)
	}
}

func TestIsHTMLTemplate(t *testing.T) {
	cases := map[string]bool{
		"index.html":    true,
		"index.HTML":    true,
		"partial.htm":   true,
		"partial.txt":   false,
		"template.tmpl": false,
	}

	for path, expected := range cases {
		if actual := isHTMLTemplate(path); actual != expected {
			t.Fatalf("expected %s to be %v, got %v", path, expected, actual)
		}
	}
}

func TestTemplateListHelper(t *testing.T) {
	result := templateList(1, "two", 3)
	if len(result) != 3 {
		t.Fatalf("expected 3 items, got %d", len(result))
	}

	if result[1] != "two" {
		t.Fatalf("expected second item to be 'two', got %v", result[1])
	}
}

func TestTemplateMapHelper(t *testing.T) {
	result, err := templateMap("name", "Gopher", "lang", "Go")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result["name"] != "Gopher" {
		t.Fatalf("expected name to equal 'Gopher', got %v", result["name"])
	}

	if _, err := templateMap("missingValue"); err == nil {
		t.Fatalf("expected error when providing uneven args")
	}

	if _, err := templateMap(10, "value"); err == nil {
		t.Fatalf("expected error when providing non-string key")
	}
}

func TestTemplateDictAlias(t *testing.T) {
	result, err := templateDict("name", "Gopher")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result["name"] != "Gopher" {
		t.Fatalf("expected name to equal 'Gopher', got %v", result["name"])
	}
}

func TestStringFilters(t *testing.T) {
	if actual := templateUpper("gopher"); actual != "GOPHER" {
		t.Fatalf("expected upper to convert to GOPHER, got %s", actual)
	}

	if actual := templateLower("GoPHer"); actual != "gopher" {
		t.Fatalf("expected lower to convert to gopher, got %s", actual)
	}

	if actual := templateTitle("go template studio"); actual != "Go Template Studio" {
		t.Fatalf("expected title to convert to 'Go Template Studio', got %s", actual)
	}

	if actual := templateCapitalize("gO template STUDIO"); actual != "Go template studio" {
		t.Fatalf("expected capitalize to convert to 'Go template studio', got %s", actual)
	}

	if actual := templateTrim("   spaced   "); actual != "spaced" {
		t.Fatalf("expected trim to remove surrounding whitespace, got %q", actual)
	}

	if actual := templateReplace("ph", "PH", "gopher"); actual != "goPHer" {
		t.Fatalf("expected replace to swap substring, got %s", actual)
	}
}

func TestTemplateJoin(t *testing.T) {
	joined, err := templateJoin(",", []string{"a", "b", "c"})
	if err != nil {
		t.Fatalf("unexpected error joining slice: %v", err)
	}
	if joined != "a,b,c" {
		t.Fatalf("expected join to produce 'a,b,c', got %s", joined)
	}

	joined, err = templateJoin("-", []interface{}{1, "two", 3})
	if err != nil {
		t.Fatalf("unexpected error joining interface slice: %v", err)
	}
	if joined != "1-two-3" {
		t.Fatalf("expected join to produce '1-two-3', got %s", joined)
	}

	if _, err := templateJoin(",", 10); err == nil {
		t.Fatal("expected error when joining non-slice value")
	}
}

func TestTemplateDefault(t *testing.T) {
	if result := templateDefault("fallback", nil); result != "fallback" {
		t.Fatalf("expected default to return fallback for nil input, got %v", result)
	}

	if result := templateDefault("fallback", "actual"); result != "actual" {
		t.Fatalf("expected default to preserve value, got %v", result)
	}

	if result := templateDefault("fallback", 0); result != "fallback" {
		t.Fatalf("expected default to treat zero as empty, got %v", result)
	}
}

func TestTemplateEscapeAndSafe(t *testing.T) {
	escaped := templateEscape("<strong>bold</strong>")
	if escaped != "&lt;strong&gt;bold&lt;/strong&gt;" {
		t.Fatalf("expected escape to HTML-encode value, got %s", escaped)
	}

	if safe := templateSafeText("<em>text</em>"); safe != "<em>text</em>" {
		t.Fatalf("expected safe text helper to return raw string, got %s", safe)
	}

	if safe := templateSafeHTML("<em>text</em>"); safe != htmltmpl.HTML("<em>text</em>") {
		t.Fatalf("expected safe HTML helper to return template.HTML, got %v", safe)
	}
}

func TestFuncMapsExposeHelpers(t *testing.T) {
	textFuncs := textFuncMap()
	if _, ok := textFuncs["list"]; !ok {
		t.Fatal("text func map missing list helper")
	}
	if _, ok := textFuncs["map"]; !ok {
		t.Fatal("text func map missing map helper")
	}
	if _, ok := textFuncs["dict"]; !ok {
		t.Fatal("text func map missing dict helper")
	}
	for _, key := range []string{"upper", "lower", "title", "capitalize", "trim", "strip", "replace", "default", "join", "escape", "safe"} {
		if _, ok := textFuncs[key]; !ok {
			t.Fatalf("text func map missing %s helper", key)
		}
	}

	htmlFuncs := htmlFuncMap()
	if _, ok := htmlFuncs["list"]; !ok {
		t.Fatal("html func map missing list helper")
	}
	if _, ok := htmlFuncs["map"]; !ok {
		t.Fatal("html func map missing map helper")
	}
	if _, ok := htmlFuncs["dict"]; !ok {
		t.Fatal("html func map missing dict helper")
	}
	for _, key := range []string{"upper", "lower", "title", "capitalize", "trim", "strip", "replace", "default", "join", "escape", "safe"} {
		if _, ok := htmlFuncs[key]; !ok {
			t.Fatalf("html func map missing %s helper", key)
		}
	}
}

func TestContextFormatForPath(t *testing.T) {
	cases := []struct {
		path     string
		expected contextFormat
	}{
		{"context/data.json", contextFormatJSON},
		{"context/data.yaml", contextFormatYAML},
		{"context/data.yml", contextFormatYAML},
		{"context/DATA.YML", contextFormatYAML},
		{"context/data.toml", contextFormatTOML},
		{"context/data.Toml", contextFormatTOML},
		{"context/data", contextFormatJSON},
		{"context/data.txt", contextFormatJSON},
	}

	for _, tc := range cases {
		if actual := contextFormatForPath(tc.path); actual != tc.expected {
			t.Errorf("contextFormatForPath(%q) = %s, want %s", tc.path, actual, tc.expected)
		}
	}
}

func TestParseContextStructuredFormats(t *testing.T) {
	cases := []struct {
		name     string
		format   contextFormat
		content  string
		template string
		expected string
	}{
		{
			name:     "yaml top-level values",
			format:   contextFormatYAML,
			content:  "Title: Hello\nItems:\n  - first\n  - second\n",
			template: "{{.Title}}:{{range .Items}} {{.}}{{end}}",
			expected: "Hello: first second",
		},
		{
			name:     "yaml nested maps",
			format:   contextFormatYAML,
			content:  "# leading comment\nSite:\n  Owner:\n    Name: Gopher\n  Tags: [go, templates]\n",
			template: "{{.Site.Owner.Name}} {{index .Site.Tags 1}}",
			expected: "Gopher templates",
		},
		{
			name:     "yaml non-string keys are stringified",
			format:   contextFormatYAML,
			content:  "Codes:\n  200: ok\n  404:\n    Text: missing\n",
			template: `{{index .Codes "200"}} {{(index .Codes "404").Text}}`,
			expected: "ok missing",
		},
		{
			name:     "yaml comments only",
			format:   contextFormatYAML,
			content:  "# nothing here yet\n",
			template: "{{len .}}",
			expected: "0",
		},
		{
			name:     "toml top-level values",
			format:   contextFormatTOML,
			content:  "Title = \"Hello\"\nItems = [\"first\", \"second\"]\n",
			template: "{{.Title}}:{{range .Items}} {{.}}{{end}}",
			expected: "Hello: first second",
		},
		{
			name:     "toml nested tables",
			format:   contextFormatTOML,
			content:  "[Site.Owner]\nName = \"Gopher\"\nAge = 14\n",
			template: "{{.Site.Owner.Name}} {{.Site.Owner.Age}}",
			expected: "Gopher 14",
		},
		{
			name:     "toml array of tables",
			format:   contextFormatTOML,
			content:  "[[Items]]\nName = \"a\"\n\n[[Items]]\nName = \"b\"\n",
			template: "{{range .Items}}{{.Name}}{{end}} {{len .Items}}",
			expected: "ab 2",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data, err := parseContext([]byte(tc.content), tc.format)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if _, ok := data.(map[string]interface{}); !ok {
				t.Fatalf("expected map[string]interface{} root, got %T", data)
			}

			rendered, err := renderTemplate("context.tmpl", tc.template, data)
			if err != nil {
				t.Fatalf("unexpected render error: %v", err)
			}

			if rendered != tc.expected {
				t.Fatalf("rendered %q, want %q", rendered, tc.expected)
			}
		})
	}
}

func TestParseContextStructuredErrors(t *testing.T) {
	cases := []struct {
		name           string
		format         contextFormat
		content        string
		expectedPrefix string
		expectedLine   int
		expectedColumn int
	}{
		{
			name:           "yaml tab indentation",
			format:         contextFormatYAML,
			content:        "Title: Hello\nItems:\n\t- first\n",
			expectedPrefix: "failed to parse context YAML: ",
			expectedLine:   3,
		},
		{
			name:           "yaml mapping inside scalar",
			format:         contextFormatYAML,
			content:        "Title: Hello\nItems: first\n  nested: oops\n",
			expectedPrefix: "failed to parse context YAML: ",
			expectedLine:   3,
		},
		{
			name:           "toml missing value",
			format:         contextFormatTOML,
			content:        "Title = \"Hello\"\n\n[Site]\nName = \n",
			expectedPrefix: "failed to parse context TOML: ",
			expectedLine:   4,
			expectedColumn: 8,
		},
		{
			name:           "toml duplicate key",
			format:         contextFormatTOML,
			content:        "Title = \"Hello\"\nTitle = \"Again\"\n",
			expectedPrefix: "failed to parse context TOML: ",
			expectedLine:   2,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := parseContext([]byte(tc.content), tc.format)
			if err == nil {
				t.Fatal("expected parse error")
			}

			parseErr, ok := err.(*contextParseError)
			if !ok {
				t.Fatalf("expected *contextParseError, got %T", err)
			}

			if !strings.HasPrefix(parseErr.Error(), tc.expectedPrefix) {
				t.Fatalf("expected message prefix %q, got %q", tc.expectedPrefix, parseErr.Error())
			}

			if parseErr.line != tc.expectedLine {
				t.Fatalf("expected line %d, got %d (%s)", tc.expectedLine, parseErr.line, parseErr.Error())
			}

			if tc.expectedColumn != 0 && parseErr.column != tc.expectedColumn {
				t.Fatalf("expected column %d, got %d (%s)", tc.expectedColumn, parseErr.column, parseErr.Error())
			}
		})
	}
}

func TestExecuteWithStructuredContextFiles(t *testing.T) {
	cases := []struct {
		name           string
		fileName       string
		content        string
		expected       string
		expectError    bool
		expectedLine   int
		expectedColumn int
	}{
		{
			name:     "yaml file",
			fileName: "context.yaml",
			content:  "Site:\n  Name: Studio\n",
			expected: "Hello Studio",
		},
		{
			name:     "yml file",
			fileName: "context.yml",
			content:  "Site: {Name: Studio}\n",
			expected: "Hello Studio",
		},
		{
			name:     "toml file",
			fileName: "context.toml",
			content:  "[Site]\nName = \"Studio\"\n",
			expected: "Hello Studio",
		},
		{
			name:         "yaml parse error",
			fileName:     "broken.yaml",
			content:      "Site:\n  Name: Studio\n  Extra: one\n    nested: oops\n",
			expectError:  true,
			expectedLine: 4,
		},
		{
			name:           "toml parse error",
			fileName:       "broken.toml",
			content:        "[Site]\nName = \n",
			expectError:    true,
			expectedLine:   2,
			expectedColumn: 8,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			templatePath := filepath.Join(dir, "greeting.tmpl")
			if err := os.WriteFile(templatePath, []byte("Hello {{.Site.Name}}"), 0o600); err != nil {
				t.Fatalf("failed to write template file: %v", err)
			}

			contextPath := filepath.Join(dir, tc.fileName)
			if err := os.WriteFile(contextPath, []byte(tc.content), 0o600); err != nil {
				t.Fatalf("failed to write context file: %v", err)
			}

			resp := execute(templatePath, contextPath)

			if !tc.expectError {
				if resp.Error != "" {
					t.Fatalf("expected successful render, got error: %s", resp.Error)
				}
				if resp.Rendered != tc.expected {
					t.Fatalf("rendered %q, want %q", resp.Rendered, tc.expected)
				}
				return
			}

			if resp.Error == "" {
				t.Fatal("expected an error for malformed context")
			}

			if len(resp.Diagnostics) != 1 {
				t.Fatalf("expected one diagnostic, got %d", len(resp.Diagnostics))
			}

			diag := resp.Diagnostics[0]
			if diag.File != contextPath {
				t.Fatalf("expected diagnostic file %q, got %q", contextPath, diag.File)
			}
			if diag.Severity != "error" {
				t.Fatalf("expected error severity, got %q", diag.Severity)
			}
			if diag.Line != tc.expectedLine {
				t.Fatalf("expected line %d, got %d (%s)", tc.expectedLine, diag.Line, diag.Message)
			}
			if diag.Column != tc.expectedColumn {
				t.Fatalf("expected column %d, got %d (%s)", tc.expectedColumn, diag.Column, diag.Message)
			}
		})
	}
}
