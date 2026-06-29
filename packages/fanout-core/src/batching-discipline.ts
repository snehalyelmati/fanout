export const BATCHING_DISCIPLINE_MARKER = "## Think-ahead batching";

export const BATCHING_DISCIPLINE = `${BATCHING_DISCIPLINE_MARKER}

Before using tools, identify all independent evidence needed for the next decision.

Batch independent actions in the same assistant turn:
- read related files together
- grep related symbols and callers together
- inspect configs, manifests, tests, docs, and git history together
- run independent read-only checks together

Do not spend another model turn just to request an obvious sibling file, caller search, manifest, or nearby test. If one read-only shell command can safely gather related facts, prefer it.

Take another tool turn only when previous results reveal a real dependency, ambiguity, or new branch of investigation.`;
