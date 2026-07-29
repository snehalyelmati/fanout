export const BATCHING_DISCIPLINE_MARKER = "Batch every independent read-only tool call needed for the next decision into one assistant turn.";

export const BATCHING_DISCIPLINE = `${BATCHING_DISCIPLINE_MARKER}

Use only tools available for the active task. Keep dependent and state-changing actions separate. Take another tool turn only when results reveal a dependency, ambiguity, or new investigation branch. Execute the batch without a separate batching-plan response.`;
