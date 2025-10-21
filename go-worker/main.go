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
	"strings"
	texttmpl "text/template"
	"time"
	"unicode/utf8"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

type diagnostic struct {
	Message  string `json:"message"`
	Severity string `json:"severity"`
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
		return response{Error: err.Error()}
	}

	rendered, err := renderTemplate(templatePath, string(templateBytes), data)
	if err != nil {
		return response{
			Diagnostics: []diagnostic{{
				Message:  err.Error(),
				Severity: "error",
			}},
			Error: err.Error(),
		}
	}

	return response{Rendered: rendered}
}

func loadContext(contextPath string) (interface{}, error) {
	if strings.TrimSpace(contextPath) == "" {
		return map[string]any{}, nil
	}

	contextBytes, err := os.ReadFile(contextPath)
	if err != nil {
		return nil, err
	}

	return parseContext(contextBytes)
}

func parseContext(content []byte) (interface{}, error) {
	trimmed := strings.TrimSpace(string(content))
	if trimmed == "" {
		return map[string]any{}, nil
	}

	var data interface{}
	if err := json.Unmarshal([]byte(trimmed), &data); err != nil {
		return nil, errors.New("failed to parse context JSON")
	}

	return data, nil
}

func renderTemplate(path, content string, data interface{}) (string, error) {
	name := filepath.Base(path)
	var execute func(interface{}) (string, error)

	if isHTMLTemplate(path) {
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

func isHTMLTemplate(path string) bool {
	lower := strings.ToLower(path)
	return strings.HasSuffix(lower, ".html") || strings.HasSuffix(lower, ".htm")
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

var (
	titleCaser = cases.Title(language.Und)
	upperCaser = cases.Upper(language.Und)
	lowerCaser = cases.Lower(language.Und)
)

func templateUpper(value interface{}) string {
	return strings.ToUpper(toString(value))
}

func templateLower(value interface{}) string {
	return strings.ToLower(toString(value))
}

func templateTitle(value interface{}) string {
	return titleCaser.String(toString(value))
}

func templateCapitalize(value interface{}) string {
	lowered := lowerCaser.String(toString(value))
	if lowered == "" {
		return ""
	}

	first, size := utf8.DecodeRuneInString(lowered)
	if first == utf8.RuneError && size == 0 {
		return ""
	}

	capitalizedFirst := upperCaser.String(string(first))
	return capitalizedFirst + lowered[size:]
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
