package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	htmltmpl "html/template"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	texttmpl "text/template"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/BurntSushi/toml"
	"gopkg.in/yaml.v3"
)

type diagnostic struct {
	Message  string `json:"message"`
	Severity string `json:"severity"`
	File     string `json:"file,omitempty"`
	Line     int    `json:"line,omitempty"`
	Column   int    `json:"column,omitempty"`
}

type response struct {
	Rendered    string       `json:"rendered,omitempty"`
	Diagnostics []diagnostic `json:"diagnostics,omitempty"`
	DurationMs  int64        `json:"durationMs"`
	Error       string       `json:"error,omitempty"`
}

func main() {
	templatePath := flag.String("template", "", "Path to the Go template file")
	contextPath := flag.String("context", "", "Path to the context data file")
	flag.Parse()

	start := time.Now()
	resp := execute(*templatePath, *contextPath)
	resp.DurationMs = time.Since(start).Milliseconds()

	encoder := json.NewEncoder(os.Stdout)
	if err := encoder.Encode(resp); err != nil {
		_, _ = os.Stderr.WriteString(err.Error())
		os.Exit(1)
	}

	if resp.Error != "" {
		os.Exit(0)
	}
}

func execute(templatePath, contextPath string) response {
	if templatePath == "" {
		return response{Error: "template path is required"}
	}

	templateBytes, err := os.ReadFile(templatePath)
	if err != nil {
		return response{Error: err.Error()}
	}

	data, err := loadContext(contextPath)
	if err != nil {
		diag := diagnostic{
			Message:  err.Error(),
			Severity: "error",
		}
		if strings.TrimSpace(contextPath) != "" {
			diag.File = contextPath
		}
		var parseErr *contextParseError
		if errors.As(err, &parseErr) {
			diag.Line = parseErr.line
			diag.Column = parseErr.column
		}
		return response{
			Diagnostics: []diagnostic{diag},
			Error:       err.Error(),
		}
	}

	rendered, err := renderTemplate(templatePath, string(templateBytes), data)
	if err != nil {
		return response{
			Diagnostics: []diagnostic{templateDiagnostic(err, templatePath)},
			Error:       err.Error(),
		}
	}

	return response{Rendered: rendered}
}

func templateDiagnostic(err error, templatePath string) diagnostic {
	diag := diagnostic{
		Message:  err.Error(),
		Severity: "error",
		File:     templatePath,
	}

	extractTemplatePosition(&diag)

	return diag
}

var templateErrorPattern = regexp.MustCompile(`template: [^:]+:(\d+)(?::(\d+))?:`)

func extractTemplatePosition(diag *diagnostic) {
	matches := templateErrorPattern.FindStringSubmatch(diag.Message)
	if len(matches) == 0 {
		return
	}

	if line, err := strconv.Atoi(matches[1]); err == nil {
		diag.Line = line
	}

	if len(matches) > 2 {
		if column, err := strconv.Atoi(matches[2]); err == nil {
			diag.Column = column
		}
	}
}

// contextFormat identifies the serialization used by a context data file.
type contextFormat string

const (
	contextFormatJSON contextFormat = "JSON"
	contextFormatYAML contextFormat = "YAML"
	contextFormatTOML contextFormat = "TOML"
)

// contextFormatForPath selects a decoder based on the file extension. Unknown
// extensions fall back to JSON to preserve the original worker behavior.
func contextFormatForPath(path string) contextFormat {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".yaml", ".yml":
		return contextFormatYAML
	case ".toml":
		return contextFormatTOML
	default:
		return contextFormatJSON
	}
}

// contextParseError reports a context decoding failure along with the 1-based
// line and column when the underlying decoder exposes them (0 when unknown).
type contextParseError struct {
	message string
	line    int
	column  int
}

func (e *contextParseError) Error() string {
	return e.message
}

func loadContext(contextPath string) (interface{}, error) {
	if strings.TrimSpace(contextPath) == "" {
		return map[string]any{}, nil
	}

	contextBytes, err := os.ReadFile(contextPath)
	if err != nil {
		return nil, err
	}

	return parseContext(contextBytes, contextFormatForPath(contextPath))
}

func parseContext(content []byte, format contextFormat) (interface{}, error) {
	trimmed := strings.TrimSpace(string(content))
	if trimmed == "" {
		return map[string]any{}, nil
	}

	switch format {
	case contextFormatYAML:
		return parseYAMLContext(content)
	case contextFormatTOML:
		return parseTOMLContext(content)
	default:
		var data interface{}
		if err := json.Unmarshal([]byte(trimmed), &data); err != nil {
			return nil, errors.New("failed to parse context JSON")
		}
		return data, nil
	}
}

// yamlLinePattern matches the position prefix yaml.v3 embeds in its error
// messages, e.g. "yaml: line 3: mapping values are not allowed".
var yamlLinePattern = regexp.MustCompile(`line (\d+)(?:, column (\d+))?`)

func parseYAMLContext(content []byte) (interface{}, error) {
	// Decode the untrimmed content so reported line numbers match the file.
	var data interface{}
	if err := yaml.Unmarshal(content, &data); err != nil {
		parseErr := &contextParseError{message: "failed to parse context YAML: " + err.Error()}
		if matches := yamlLinePattern.FindStringSubmatch(err.Error()); matches != nil {
			parseErr.line, _ = strconv.Atoi(matches[1])
			if matches[2] != "" {
				parseErr.column, _ = strconv.Atoi(matches[2])
			}
		}
		return nil, parseErr
	}

	if data == nil {
		// A document containing only comments decodes to nil.
		return map[string]any{}, nil
	}

	return normalizeContextValue(data), nil
}

func parseTOMLContext(content []byte) (interface{}, error) {
	data := map[string]interface{}{}
	if _, err := toml.Decode(string(content), &data); err != nil {
		parseErr := &contextParseError{message: "failed to parse context TOML: " + err.Error()}
		var tomlErr toml.ParseError
		if errors.As(err, &tomlErr) {
			parseErr.line = tomlErr.Position.Line
			parseErr.column = tomlErr.Position.Col
		}
		return nil, parseErr
	}

	return normalizeContextValue(data), nil
}

// normalizeContextValue converts decoder-specific types into the shapes
// encoding/json produces so templates behave identically regardless of the
// context file format: containers become map[string]interface{} and
// []interface{}, every integer and float type becomes float64 (as JSON numbers
// do), and dates/times become strings.
func normalizeContextValue(value interface{}) interface{} {
	switch typed := value.(type) {
	case int:
		return float64(typed)
	case int8:
		return float64(typed)
	case int16:
		return float64(typed)
	case int32:
		return float64(typed)
	case int64:
		return float64(typed)
	case uint:
		return float64(typed)
	case uint8:
		return float64(typed)
	case uint16:
		return float64(typed)
	case uint32:
		return float64(typed)
	case uint64:
		return float64(typed)
	case float32:
		return float64(typed)
	case time.Time:
		return formatContextTime(typed)
	case map[string]interface{}:
		for key, item := range typed {
			typed[key] = normalizeContextValue(item)
		}
		return typed
	case map[interface{}]interface{}:
		converted := make(map[string]interface{}, len(typed))
		for key, item := range typed {
			converted[fmt.Sprint(key)] = normalizeContextValue(item)
		}
		return converted
	case []interface{}:
		for i, item := range typed {
			typed[i] = normalizeContextValue(item)
		}
		return typed
	case []map[string]interface{}:
		converted := make([]interface{}, len(typed))
		for i, item := range typed {
			converted[i] = normalizeContextValue(item)
		}
		return converted
	default:
		return value
	}
}

// TOML local date/time values decode with these zone names (see the toml
// package's internal LocalDatetime/LocalDate/LocalTime locations); they carry
// no real offset, so they are formatted without one.
const (
	tomlLocalDatetimeZone = "datetime-local"
	tomlLocalDateZone     = "date-local"
	tomlLocalTimeZone     = "time-local"
)

// formatContextTime renders decoded dates/times as RFC 3339 strings (the
// full-date or partial-time subset for TOML local dates and times) so a
// context value has the same type it would have when written as a JSON string.
func formatContextTime(value time.Time) string {
	switch value.Location().String() {
	case tomlLocalDatetimeZone:
		return value.Format("2006-01-02T15:04:05.999999999")
	case tomlLocalDateZone:
		return value.Format("2006-01-02")
	case tomlLocalTimeZone:
		return value.Format("15:04:05.999999999")
	default:
		return value.Format(time.RFC3339Nano)
	}
}

func renderTemplate(path, content string, data interface{}) (string, error) {
	name := filepath.Base(path)
	var execute func(interface{}) (string, error)

	if isHTMLTemplate(path, content) {
		execute = func(value interface{}) (string, error) {
			tmpl, err := htmltmpl.New(name).Funcs(htmlFuncMap()).Parse(content)
			if err != nil {
				return "", err
			}

			var builder strings.Builder
			if err := tmpl.Execute(&builder, value); err != nil {
				return "", err
			}
			return builder.String(), nil
		}
	} else {
		execute = func(value interface{}) (string, error) {
			tmpl, err := texttmpl.New(name).Funcs(textFuncMap()).Parse(content)
			if err != nil {
				return "", err
			}

			var builder strings.Builder
			if err := tmpl.Execute(&builder, value); err != nil {
				return "", err
			}
			return builder.String(), nil
		}
	}

	return execute(data)
}

// templateExtensions are the Go template file extensions contributed by the
// extension; an HTML extension directly before one (email.html.tmpl) marks the
// template as HTML.
var templateExtensions = map[string]bool{".tmpl": true, ".tpl": true, ".gotmpl": true}

// htmlDocumentPattern matches content that starts with an HTML doctype or
// <html> element (case-insensitive, after optional ASCII whitespace).
var htmlDocumentPattern = regexp.MustCompile(`(?i)^[\t\n\f\r ]*(?:<!doctype[\t\n\f\r ]+html|<html[\t\n\f\r />])`)

// isHTMLTemplate reports whether a template renders HTML and should therefore
// use html/template (contextual escaping). The rule must stay in sync with
// isHtmlTemplate in src/services/previewManager.ts, which picks the preview's
// HTML view: a .html/.htm extension, an inner .html/.htm extension before a
// template extension (page.html.tmpl), or otherwise content that starts with
// an HTML doctype or <html> element.
func isHTMLTemplate(path, content string) bool {
	lower := strings.ToLower(filepath.Base(path))
	ext := filepath.Ext(lower)
	if ext == ".html" || ext == ".htm" {
		return true
	}
	if templateExtensions[ext] {
		inner := filepath.Ext(strings.TrimSuffix(lower, ext))
		if inner == ".html" || inner == ".htm" {
			return true
		}
	}

	return htmlDocumentPattern.MatchString(strings.TrimPrefix(content, "\ufeff"))
}

func templateList(values ...interface{}) []interface{} {
	return values
}

func templateMap(values ...interface{}) (map[string]interface{}, error) {
	if len(values)%2 != 0 {
		return nil, errors.New("map helper requires key/value pairs")
	}

	result := make(map[string]interface{}, len(values)/2)
	for i := 0; i < len(values); i += 2 {
		key, ok := values[i].(string)
		if !ok {
			return nil, errors.New("map helper keys must be strings")
		}
		result[key] = values[i+1]
	}

	return result, nil
}

func templateDict(values ...interface{}) (map[string]interface{}, error) {
	return templateMap(values...)
}

func toString(value interface{}) string {
	return fmt.Sprint(value)
}

func templateUpper(value interface{}) string {
	return strings.ToUpper(toString(value))
}

func templateLower(value interface{}) string {
	return strings.ToLower(toString(value))
}

func templateTitle(value interface{}) string {
	input := toString(value)
	if input == "" {
		return ""
	}

	var builder strings.Builder
	builder.Grow(len(input))

	capitalizeNext := true
	for _, r := range input {
		if capitalizeNext {
			builder.WriteRune(unicode.ToTitle(r))
		} else {
			builder.WriteRune(unicode.ToLower(r))
		}

		capitalizeNext = !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}

	return builder.String()
}

func templateCapitalize(value interface{}) string {
	lowered := strings.ToLower(toString(value))
	if lowered == "" {
		return ""
	}

	first, size := utf8.DecodeRuneInString(lowered)
	if first == utf8.RuneError && size == 0 {
		return ""
	}

	var builder strings.Builder
	builder.Grow(len(lowered))
	builder.WriteRune(unicode.ToTitle(first))
	builder.WriteString(lowered[size:])
	return builder.String()
}

func templateTrim(value interface{}) string {
	return strings.TrimSpace(toString(value))
}

func templateReplace(old interface{}, new interface{}, value interface{}) string {
	return strings.ReplaceAll(toString(value), toString(old), toString(new))
}

func templateJoin(sep interface{}, values interface{}) (string, error) {
	joiner := toString(sep)
	collection := reflect.ValueOf(values)
	if !collection.IsValid() {
		return "", errors.New("join helper requires an array or slice")
	}

	switch collection.Kind() {
	case reflect.Array, reflect.Slice:
	default:
		return "", errors.New("join helper requires an array or slice")
	}

	parts := make([]string, collection.Len())
	for i := 0; i < collection.Len(); i++ {
		parts[i] = toString(collection.Index(i).Interface())
	}

	return strings.Join(parts, joiner), nil
}

func templateDefault(defaultValue interface{}, value interface{}) interface{} {
	if isFalsy(value) {
		return defaultValue
	}
	return value
}

func isFalsy(value interface{}) bool {
	if value == nil {
		return true
	}

	rv := reflect.ValueOf(value)

	switch rv.Kind() {
	case reflect.Bool:
		return !rv.Bool()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return rv.Int() == 0
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return rv.Uint() == 0
	case reflect.Float32, reflect.Float64:
		return rv.Float() == 0
	case reflect.String:
		return rv.Len() == 0
	case reflect.Array, reflect.Slice, reflect.Map:
		return rv.Len() == 0
	case reflect.Ptr, reflect.Interface:
		return rv.IsNil()
	case reflect.Invalid:
		return true
	}

	return false
}

func templateEscape(value interface{}) string {
	return htmltmpl.HTMLEscapeString(toString(value))
}

func templateSafeText(value interface{}) string {
	return toString(value)
}

func templateSafeHTML(value interface{}) htmltmpl.HTML {
	return htmltmpl.HTML(toString(value))
}

func textFuncMap() texttmpl.FuncMap {
	return texttmpl.FuncMap{
		"list":       templateList,
		"map":        templateMap,
		"dict":       templateDict,
		"upper":      templateUpper,
		"lower":      templateLower,
		"title":      templateTitle,
		"capitalize": templateCapitalize,
		"trim":       templateTrim,
		"strip":      templateTrim,
		"replace":    templateReplace,
		"default":    templateDefault,
		"join":       templateJoin,
		"escape":     templateEscape,
		"safe":       templateSafeText,
	}
}

func htmlFuncMap() htmltmpl.FuncMap {
	return htmltmpl.FuncMap{
		"list":       templateList,
		"map":        templateMap,
		"dict":       templateDict,
		"upper":      templateUpper,
		"lower":      templateLower,
		"title":      templateTitle,
		"capitalize": templateCapitalize,
		"trim":       templateTrim,
		"strip":      templateTrim,
		"replace":    templateReplace,
		"default":    templateDefault,
		"join":       templateJoin,
		"escape":     templateEscape,
		"safe":       templateSafeHTML,
	}
}
