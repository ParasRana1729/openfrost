# OpenFrost landing page redesign brief

## Product facts to preserve

- OpenFrost is a Windows-first personal AI assistant with one assistant identity.
- It supports research briefs, project updates, and weekly planning routines.
- The API owns a SQLite-backed queue; one run can be active globally.
- Research uses public web search and a bounded page fetch. Project updates read supported files only inside explicitly granted roots.
- Weekly planning is project-scoped and uses granted notes and recent saved updates.
- Completed work is saved as source-backed Markdown artifacts with task history.
- Structured state is local; provider keys use Windows DPAPI.
- Model prompts, selected context, and retrieved excerpts go to the configured provider. Local runtime does not mean offline model processing.
- OpenAI, Gemini, and OpenRouter adapters exist; one provider is selected in Settings.
- Export is a reviewed exact proposal to a granted destination. Arbitrary shell and OS control are outside v0.1.
- Execution defaults are 12 steps, 10 minutes, 20,000 input characters, and 100,000 output characters.
- The local API and UI bind to loopback; owner sessions and origin/CSRF checks protect access.
- Windows is the supported platform. There is no packaged installer published yet.

## Concept and copy

**Idea:** OpenFrost’s scoped, source-backed task record becomes the editorial material of the page: a landing page laid out like the artifacts its assistant produces.

**Five-second description:** A Windows-first personal assistant for research, project updates, and weekly plans. It runs one task at a time and saves the result with its sources.

**Competitor substitution test:** Replacing OpenFrost with a general web chatbot would erase the local queue, explicitly scoped project inputs, durable run history, and saved source-backed artifact.

**Section plan:** image masthead and concise hero; workflow exchange; three work types with illustrative artifact fragments; interactive sample workbench; local/provider boundary; real execution limits; build-from-source call to action; concise FAQ and photographic credits.

**Copy deck:**

- Hero: “One task at a time. Work worth keeping.”
- Standfirst: “A Windows-first assistant for research, project updates, and weekly plans. Every run has a clear scope; finished work keeps its sources.”
- Main action: “Explore the source” (no installer exists).
- Workflow: “Request → scoped context → saved record.”
- Boundary: “Your runtime is local. Model processing happens with the provider you choose.”
- Samples are plainly labeled as illustrative and never claim to contact a model.
- Build section: “Build OpenFrost” with Node.js 24–26 and pnpm 10.34.7, repository Quick start, and visible no-installer status.

## Live element

The existing interactive task preview stays editable and changes across the three real workflows; its preview result is explicitly a local illustrative sample, never a model request. The product-tour tabs remain interactive and labeled sample screens.

## Composition decisions and redraws

- Chosen direction: editorial-report, seed 565771064, preserving the existing Anton/Archivo typography and dark/cyan palette.
- Hero uses a wide image mosaic first, with headline and standfirst immediately below. Four licensed snowflake macro photographs establish the brand's material; original HTML interface fragments show product concepts without pretending to be screenshots.
- Redraw 1, how-it-works: replaced a many-to-one diagram because it could suggest cross-project context mixing; the true sequence is request, scoped evidence, saved artifact.
- Redraw 2, stats: replaced a chart with four quiet figure lines because there is no real time series and only four verified execution limits.
- Redraw 3, CTA: replaced a photo/person CTA with a single “Build” action because no installer is available and a download claim would be false.
- No suitable short video was found. The page uses four sourced photographs and original interface fragments instead of unrelated footage.

## User-directed flash pass — 2026-10-26

The owner said the prior revision still felt too restrained and asked for a flashy redesign with modern motion. The visual direction borrows from a streetwear poster: electric blue fields, acid-lime accents, very large condensed type, and a photographic crystal framed as the material that carries the OpenFrost name. The existing Anton/Archivo faces remain; the blue/lime contrast is a deliberate palette redraw to meet the owner's request for more impact.

**Idea:** OpenFrost's bounded task record becomes a poster collage: a real snow crystal behind an illustrative Control Center, with granted scope and a saved artifact floating into view.

**Hero copy:** “AI gets to work.” The standfirst names the three workflows and the source-backed result; the source repository remains the primary action because no installer exists.

**Motion:** A slow crystal drift, floating scope/result fragments, an entering sample workspace, animated local-status indicator, interactive workflow and workspace tabs, hover response, and the existing scroll reveals. Every continuous motion stops under `prefers-reduced-motion`.

**Reviewed production result:** the skill inspector reports 0 FAIL at 1440, 768, and 390px. It still warns on the wide display-to-interface size range, absent relevant video, and one soft-grey text contrast sample. The final screenshots are `.taste-skill/revamp/flashy/release-candidate/desktop-fold.jpg`, `tablet-fold.jpg`, and `mobile-fold.jpg`; every listed page sheet was also reviewed. The sample workspace is illustrative, and the existing footer credits the four snow-crystal photographs.
