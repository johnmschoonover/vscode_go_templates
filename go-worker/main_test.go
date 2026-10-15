package main

import (
	htmltmpl "html/template"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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
	cases := []struct {
		name     string
		path     string
		content  string
		expected bool
	}{
		{name: "html extension", path: "index.html", content: "plain", expected: true},
		{name: "uppercase html extension", path: "index.HTML", content: "plain", expected: true},
		{name: "htm extension", path: "partial.htm", content: "plain", expected: true},
		{name: "txt extension", path: "partial.txt", content: "plain", expected: false},
		{name: "plain tmpl", path: "template.tmpl", content: "Hello {{.Name}}", expected: false},
		{name: "inner html before tmpl", path: "email.html.tmpl", content: "Hello", expected: true},
		{name: "inner htm before gotmpl", path: "page.HTM.gotmpl", content: "Hello", expected: true},
		{name: "inner html before tpl", path: "/work/dir.x/page.html.tpl", content: "Hello", expected: true},
		{name: "inner txt before tmpl", path: "notes.txt.tmpl", content: "Hello", expected: false},
		{name: "html directory does not count", path: "/site.html/readme.tmpl", content: "Hello", expected: false},
		{name: "doctype sniffed", path: "asdf.go.tmpl", content: "<!DOCTYPE html>\n<html></html>", expected: true},
		{name: "doctype lowercase after whitespace", path: "page.tmpl", content: "\n  \t<!doctype html>", expected: true},
		{name: "doctype after bom", path: "page.tmpl", content: "\ufeff<!DOCTYPE html>", expected: true},
		{name: "html element sniffed", path: "page.tpl", content: "<HTML lang=\"en\">", expected: true},
		{name: "bare html element", path: "page.tpl", content: "<html>", expected: true},
		{name: "fragment is not sniffed", path: "partial.tmpl", content: "<div>{{.}}</div>", expected: false},
		{name: "doctype after text", path: "page.tmpl", content: "{{/* c */}}<!DOCTYPE html>", expected: false},
		{name: "html prefix of another element", path: "page.tmpl", content: "<htmlish>", expected: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if actual := isHTMLTemplate(tc.path, tc.content); actual != tc.expected {
				t.Fatalf("isHTMLTemplate(%q, %q) = %v, want %v", tc.path, tc.content, actual, tc.expected)
			}
		})
	}
}

func TestRenderTemplateEscapingFollowsHTMLDetection(t *testing.T) {
	data := map[string]any{"value": "<b>&</b>"}
	cases := []struct {
		name     string
		path     string
		content  string
		expected string
	}{
		{name: "plain tmpl is not escaped", path: "plain.tmpl", content: "{{.value}}", expected: "<b>&</b>"},
		{name: "inner html extension is escaped", path: "email.html.tmpl", content: "{{.value}}", expected: "&lt;b&gt;&amp;&lt;/b&gt;"},
		{
			name:     "sniffed document is escaped",
			path:     "asdf.go.tmpl",
			content:  "<!DOCTYPE html><p>{{.value}}</p>",
			expected: "<!DOCTYPE html><p>&lt;b&gt;&amp;&lt;/b&gt;</p>",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rendered, err := renderTemplate(tc.path, tc.content, data)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if rendered != tc.expected {
				t.Fatalf("rendered %q, want %q", rendered, tc.expected)
			}
		})
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

func TestNormalizeContextValueScalars(t *testing.T) {
	offset := time.FixedZone("offset", -7*60*60)
	cases := []struct {
		name     string
		input    interface{}
		expected interface{}
	}{
		{name: "int", input: 3, expected: float64(3)},
		{name: "int8", input: int8(-3), expected: float64(-3)},
		{name: "int16", input: int16(3), expected: float64(3)},
		{name: "int32", input: int32(3), expected: float64(3)},
		{name: "int64", input: int64(3), expected: float64(3)},
		{name: "uint", input: uint(3), expected: float64(3)},
		{name: "uint8", input: uint8(3), expected: float64(3)},
		{name: "uint16", input: uint16(3), expected: float64(3)},
		{name: "uint32", input: uint32(3), expected: float64(3)},
		{name: "uint64", input: uint64(3), expected: float64(3)},
		{name: "float32", input: float32(1.5), expected: float64(1.5)},
		{name: "float64", input: 2.25, expected: 2.25},
		{name: "utc time", input: time.Date(1979, 5, 27, 7, 32, 0, 0, time.UTC), expected: "1979-05-27T07:32:00Z"},
		{name: "offset time", input: time.Date(1979, 5, 27, 0, 32, 0, 999999000, offset), expected: "1979-05-27T00:32:00.999999-07:00"},
		{name: "string", input: "text", expected: "text"},
		{name: "bool", input: true, expected: true},
		{name: "nil", input: nil, expected: nil},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			actual := normalizeContextValue(tc.input)
			if actual != tc.expected {
				t.Fatalf("normalizeContextValue(%#v) = %#v (%T), want %#v (%T)", tc.input, actual, actual, tc.expected, tc.expected)
			}
		})
	}
}

func TestParseContextValueTypesMatchJSON(t *testing.T) {
	cases := []struct {
		name    string
		format  contextFormat
		content string
	}{
		{name: "json", format: contextFormatJSON, content: `{"num": 3, "price": 4.5, "big": 9007199254740993, "neg": -2, "list": [1, 2.5], "nested": {"n": 7}, "when": "1979-05-27T07:32:00Z"}`},
		{name: "yaml", format: contextFormatYAML, content: "num: 3\nprice: 4.5\nbig: 9007199254740993\nneg: -2\nlist: [1, 2.5]\nnested:\n  n: 7\nwhen: 1979-05-27T07:32:00Z\n"},
		{name: "toml", format: contextFormatTOML, content: "num = 3\nprice = 4.5\nbig = 9007199254740993\nneg = -2\nlist = [1, 2.5]\nwhen = 1979-05-27T07:32:00Z\n[nested]\nn = 7\n"},
	}

	template := `{{printf "%.2f" .num}}|{{if eq .num 3.0}}three{{end}}|{{printf "%T" .num}}|{{printf "%T" .big}}|{{.neg}}|{{range .list}}{{printf "%T " .}}{{end}}|{{printf "%T" .nested.n}}|{{.when}}|{{printf "%T" .when}}`
	expected := "3.00|three|float64|float64|-2|float64 float64 |float64|1979-05-27T07:32:00Z|string"

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data, err := parseContext([]byte(tc.content), tc.format)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			rendered, err := renderTemplate("types.tmpl", template, data)
			if err != nil {
				t.Fatalf("unexpected render error: %v", err)
			}
			if rendered != expected {
				t.Fatalf("rendered %q, want %q", rendered, expected)
			}
		})
	}
}

func TestParseContextTOMLLocalDatesAndTimes(t *testing.T) {
	content := "dt = 1979-05-27T07:32:00.5\nd = 1979-05-27\nt = 07:32:00\noffset = 1979-05-27T07:32:00-07:00\n"
	data, err := parseContext([]byte(content), contextFormatTOML)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	values := data.(map[string]interface{})
	expected := map[string]string{
		"dt":     "1979-05-27T07:32:00.5",
		"d":      "1979-05-27",
		"t":      "07:32:00",
		"offset": "1979-05-27T07:32:00-07:00",
	}
	for key, want := range expected {
		if got := values[key]; got != want {
			t.Fatalf("%s = %#v (%T), want %q", key, got, got, want)
		}
	}
}
