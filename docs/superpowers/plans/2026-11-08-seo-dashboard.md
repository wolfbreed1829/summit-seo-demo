# Summit SEO implementation plan

> Execute using the subagent-driven-development skill. Build and verify continuously within the user's authorized request.

**Goal:** Deliver a usable dark SEO dashboard served by Unison with actual on-page analysis.

**Architecture:** Unison owns the HTTP service and audit rules. Static browser assets own rendering, CSV import and local persistence. Integrations display their actual disconnected status.

**Tech stack:** Unison 1.3, @unison/http 8.0.0, HTML, CSS, vanilla browser JavaScript. The direct HTTP library replaces routes, avoiding its unnecessary cloud dependencies for this local server.

- [x] Create isolated UCM project summit-seo and install HTTP library; inspect installed APIs.
- [x] Implement web/index.html, web/styles.css, web/app.js: responsive overview, chart, searchable opportunities, review drawer, audit HTML form, change history, CSV import and JSON export. Use POST /api/analyze with raw HTML. Display explicit demo labels.
- [x] Write audit test cases before implementing src/audit.u. Test title, description, H1, canonical, language, noindex, image alt. Return {score,title,description,h1Count,imageCount,missingAlt,checks:[{id,label,status,detail}]}.
- [x] Implement src/server.u to serve fixed asset paths and bounded POST /api/analyze; bind loopback. Compile and launch.
- [x] Verify pure audit tests and HTTP behavior; inspect desktop/mobile in browser and exercise core flows.
- [x] Review requirements and code quality, fix findings, document launch and limitations in README.md.

## Verification results

- Seven pure Unison tests pass; nine HTTP integration tests pass against the compiled Unison runtime.
- Browser QA: navigation, 28/90-day chart, search/filter, editable preview, saved approvals/dismissals, undo, refresh persistence, valid/invalid CSV import, actual HTML audit, stale result invalidation, JSON export and workspace reset.
- Mobile QA: 390px viewport, no document overflow across all five views; menu and drawer work. Desktop/mobile screenshots saved under artifacts/.
- Spec/code review findings fixed: combined robots `none` directives, stale audit result handling, and history truncation hiding older Undo actions.
