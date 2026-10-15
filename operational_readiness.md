# Operational Readiness Checklist: Go Template Studio for VS Code

## 1. Release Management
- **Versioning:** Follow semantic versioning. The git tag must match the `package.json` version (`v1.1.0` ↔ `1.1.0`); earlier `v1.0.x` tags predate this rule. Document changes in `CHANGELOG.md` (✅ created; `1.1.0` entry drafted).
- **Packaging Workflow:**
  1. Run `npm run build` and ensure output passes lint/tests.
  2. Execute `vsce package` to produce `.vsix` artifact.
  3. Perform manual smoke validation using packaged `.vsix` before publishing.
- **Publishing:** Use shared Microsoft publisher account (to be created) with MFA enabled. Publish extension as free and open-source with MIT license. Funding links (Marketplace `sponsor` field, `.github/FUNDING.yml`, README badge) are in place.
- **Rollback Plan:** Maintain previous `.vsix` artifacts: the `Release` workflow uploads each packaged `.vsix` as a workflow artifact and, for tag runs, attaches it to the GitHub release for that tag. If a critical regression occurs, unpublish the latest version and republish the prior stable release's attached `.vsix` within 24 hours (users can also sideload it with **Extensions: Install from VSIX…**).

## 2. Documentation & Support
- **User Docs:**
  - `README.md` summarizing features, installation, and quickstart (✅ restructured as the Marketplace listing body).
  - `docs/quickstart.md` with screenshots and sample workflow.
  - `docs/faq.md` covering known limitations (e.g., fallback renderer availability).
- **Developer Docs:** Technical spec and contribution guidelines (`CONTRIBUTING.md`, ✅ created).
- **Support Playbook:**
  - GitHub issue templates (bug, feature request, question) (✅ created under `.github/ISSUE_TEMPLATE/`, plus a pull request template).
  - Response expectations: acknowledge new issues within 48 hours, provide workaround or fix plan within 5 business days.

## 3. Monitoring & Telemetry
- **Telemetry Policy:** Opt-in prompt explains anonymous usage metrics (preview activations, export usage). No content or file paths captured.
- **Dashboards:**
  - GitHub Insights for issue volume and response times.
  - VS Code Marketplace download stats and rating trends (review weekly).
- **Alerting:** Configure GitHub notifications for new issues labelled `critical` or `security`.

## 4. Incident Response
- **Ownership:** Product & Engineering Duo (document owners) share responsibility for release health and support.
- **Severity Levels:**
  - Sev 0: Extension crashes VS Code or corrupts user data — respond within 12 hours.
  - Sev 1: Core preview functionality broken — respond within 24 hours.
  - Sev 2: Non-blocking bug with workaround — respond within 3 days.
- **Communication Channels:** Update GitHub issues with status, post release notes in README, and optionally notify via social media if outage is widespread.

## 5. Community Engagement
- Encourage contributions by tagging `good first issue` and `help wanted` labels.
- Publish sample templates/context bundles to inspire usage and gather feedback.
- Share roadmap updates quarterly through GitHub Discussions and README changelog snippets.
- Highlight that the extension is free and community-supported; invite maintainers from open-source Go projects to test pre-releases.

## 6. Post-Launch Iteration
- Collect user feedback via GitHub Discussions and optional in-extension survey (links only; no embedded forms).
- Prioritize backlog items that directly improve preview fidelity, context tooling, or accessibility.
- Reassess fallback renderer need based on telemetry and user feedback after first two releases.
