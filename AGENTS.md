# Agent Instructions

This repository is still in its early scaffolding phase. Follow these guidelines when making changes:

1. **Stay Aligned With Docs:** Review `PRD.md` and `technical_spec.md` before implementing features. Large functional changes should reference the relevant requirements.
2. **Prefer Small, Incremental Steps:** Introduce features gradually and leave clear TODOs for future work rather than shipping speculative end-to-end implementations in a single change.
3. **Validate Developer Workflow:** Keep `npm run compile`, `npm run lint`, and `npm run typecheck` passing. Update scripts or configuration when adding new tooling.
4. **Document Scope:** Update `README.md` (or other relevant docs) whenever the implemented surface area changes materially so contributors know the current capabilities.
5. **Surface Open Questions:** When requirements are unclear, ask for clarification instead of guessing at behavior. Document any assumptions you must make in the code comments or commit message.
