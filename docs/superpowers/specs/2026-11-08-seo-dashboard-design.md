# Summit SEO dashboard

Build a local SEO workspace inspired by RankSteward's audit, review, measure cycle. User selected a working dashboard and specifically requires the Unison programming language, dark backgrounds, and easy-to-read text.

Visual direction: charcoal canvas, slightly raised panels, warm white text, mint accents, generous spacing, legible 15–16px body text. Sidebar navigation; overview with performance chart and prioritized opportunities; review drawer with search preview; audits; changes; connections. Responsive layout and keyboard accessible controls.

Architecture: a real Unison HTTP server using @unison/http 8.0.0 serves browser HTML/CSS/JavaScript and exposes a pure Unison SEO audit engine through POST /api/analyze (raw HTML request body, JSON response). Browser JavaScript handles presentation and local workspace persistence. Sample analytics are explicitly marked demo; no fictional provider connections or publishing. Analyze pasted/uploaded HTML as real page evidence. Search Console CSV import provides real page metrics without requiring credentials. Review decisions remain local and exportable. The server binds to 127.0.0.1:4174 and accepts HTML under 500 KB.

Core audit checks: title presence and length, description presence and length, single H1, canonical, document language, noindex, image alt coverage. Score is a transparent checklist score, not a predicted Google ranking. Inputs are bounded; errors are readable. External HTML is never executed.

Verification: typecheck and run Unison; test missing metadata, healthy document, case and quote variations, noindex, empty input; browser test overview/navigation/filter/review persistence/audit/CSV import/export and mobile overflow.
