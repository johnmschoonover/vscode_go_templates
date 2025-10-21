package main

import (
	"encoding/json"
	"errors"
	"flag"
	htmltmpl "html/template"
	"os"
	"path/filepath"
	"strings"
	texttmpl "text/template"
	"time"
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

func textFuncMap() texttmpl.FuncMap {
	return texttmpl.FuncMap{
		"list": templateList,
		"map":  templateMap,
	}
}

func htmlFuncMap() htmltmpl.FuncMap {
	return htmltmpl.FuncMap{
		"list": templateList,
		"map":  templateMap,
	}
}
