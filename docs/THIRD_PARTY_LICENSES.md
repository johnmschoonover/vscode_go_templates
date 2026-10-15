# Third-Party Licenses

The Go Template Studio extension bundles third-party assets under their respective licenses.

## TextMate Grammar
- **Component:** Go Template TextMate grammar (`syntaxes/go-template.tmLanguage.json`)
- **Source:** [jinliming2/vscode-go-template](https://github.com/jinliming2/vscode-go-template) (vendored snapshot)
- **License:** MIT (see [`third_party/licenses/jinliming2-vscode-go-template/LICENSE`](../third_party/licenses/jinliming2-vscode-go-template/LICENSE))

## Go Worker Modules
The renderer worker's Go dependencies are vendored in `go-worker/vendor/` (shipped for the `go run` fallback) and compiled into the bundled `go-worker` binaries.

- **Component:** `gopkg.in/yaml.v3` v3.0.1 (YAML context decoding)
- **License:** MIT and Apache 2.0 (see [`go-worker/vendor/gopkg.in/yaml.v3/LICENSE`](../go-worker/vendor/gopkg.in/yaml.v3/LICENSE) and [`NOTICE`](../go-worker/vendor/gopkg.in/yaml.v3/NOTICE))
- **Component:** `github.com/BurntSushi/toml` v1.6.0 (TOML context decoding)
- **License:** MIT (see [`go-worker/vendor/github.com/BurntSushi/toml/COPYING`](../go-worker/vendor/github.com/BurntSushi/toml/COPYING))

