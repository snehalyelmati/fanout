# Public release check

The working tree can be curated without deleting local evidence. Recorded sessions, event streams, prompts, tool logs, and full Fanout traces belong in ignored local storage. Public results may include selected run summaries, aggregate timings/costs, configuration, outcome labels, and static figures made from selected spans. A summary timeline is not a replay.

Before publication:

1. Check the **exact public Git refs and history**, not just the latest tree. Historical commits `46d21cf`, `30a1338`, and `9565e72` contain complete observability or Pi-session JSONL; `b2751e1` introduced recorded full prompt variants; feature history beginning at `4d793e5` includes a profiler prototype later populated with an embedded event sequence. Deleting these files in a newer commit does not remove their historical blobs. A normal merge into a public repository exposes reachable history. Choose and review a publication strategy that excludes the raw blobs, such as a clean source snapshot or a separately reviewed sanitized history. Keep the original evidence local; do not rewrite shared history as an incidental cleanup step.
2. Scan the selected public tree, figures, and generated report assets for full event/session arrays, prompt or tool transcripts, credentials, and personal filesystem paths. Replace absolute evidence links with run IDs and curated source descriptions.
3. Check the public summaries against the local evidence for outcome, quality, timing, cost, and model roles. Label measured results, trace-derived counterfactuals, and synthetic assumptions separately. Removing recorded inputs from the public tree does not make historical results synthetic; readers cannot replay every historical measurement from public files alone.
4. Run the documented source setup and offline checks from a clean checkout. Keep credentials in environment variables and generated outputs under ignored paths.

The targeted repository scan found no high-confidence literal API credential in tracked files, but recognized patterns cannot prove absence of all secret formats. Review the exact publication artifact and refs with an appropriate secret scanner before changing repository visibility.

## Preparation validation — 2026-09-16

The documented clean source install, local offline stub and typecheck passed with Pi 0.85.1. The complete offline check suite, provider mock tests and generated synthetic benchmark smoke passed; the profiler suite contains 49 tests and 452 assertions. Figure generation passed its data/arithmetic checks, and both figures were visually reviewed. Public documentation links resolve, and the proposed tree's targeted scan found no personal home paths, credential-pattern matches or recorded trace literals. The original removed evidence files were checked byte-for-byte against their private copies. These checks made no paid model calls.

Source setup uses an npm-compatible workspace dependency and Pi's public SDK export. Profiler tests run from their own workspace so local evidence archives are not collected as tests. Two intentionally hanging timeout fixtures now allow one second for process startup; their previous 40 ms deadline could fire before diagnostic setup. Source installs remain unpinned without a committed dependency lock.

A source archive made with `git archive` contains the selected committed tree without Git history or ignored local evidence. It can be reviewed as the input to a fresh public repository. Creating such an archive does not sanitize this repository's existing history, publish it, or authorize a visibility change.
