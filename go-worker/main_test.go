package main

import "testing"

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
}

func TestRenderTemplateSupportsHelpersWithoutContext(t *testing.T) {
	template := `{{$list := list "a" "b"}}{{index $list 1}}{{$map := map "key" "value"}}{{index $map "key"}}`
	rendered, err := renderTemplate("test.tmpl", template, map[string]any{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "bvalue"
	if rendered != expected {
		t.Fatalf("expected %q, got %q", expected, rendered)
	}
}
