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

	if contextPath == "" {
		return response{Error: "context path is required"}
	}

	templateBytes, err := os.ReadFile(templatePath)
	if err != nil {
		return response{Error: err.Error()}
	}

	contextBytes, err := os.ReadFile(contextPath)
	if err != nil {
		return response{Error: err.Error()}
	}

	data, err := parseContext(contextBytes)
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

func textFuncMap() texttmpl.FuncMap {
	return texttmpl.FuncMap{
		"list": templateList,
	}
}

func htmlFuncMap() htmltmpl.FuncMap {
	return htmltmpl.FuncMap{
		"list": templateList,
	}
}
