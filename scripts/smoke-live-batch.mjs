if (!process.env.DOUBLEWORD_API_KEY) {
  console.log("skipping live batch smoke: DOUBLEWORD_API_KEY is not set");
  process.exit(0);
}
if (process.env.DOUBLEWORD_LIVE_BATCH !== "1") {
  console.log("skipping live batch smoke: set DOUBLEWORD_LIVE_BATCH=1 to create/cancel a real batch");
  process.exit(0);
}

const baseUrl = (process.env.DOUBLEWORD_BASE_URL ?? "https://api.doubleword.ai/v1").replace(/\/$/, "");
const model = process.env.DOUBLEWORD_LIVE_BATCH_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash";
const headers = { authorization: `Bearer ${process.env.DOUBLEWORD_API_KEY}` };

async function json(response) {
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
  return body;
}

const line = JSON.stringify({
  custom_id: "smoke-1",
  method: "POST",
  url: "/v1/chat/completions",
  body: { model, messages: [{ role: "user", content: "Respond 'hello', do not say anything else." }] },
});

const form = new FormData();
form.set("purpose", "batch");
form.set("file", new Blob([`${line}\n`], { type: "application/jsonl" }), "doubleword-batch-smoke.jsonl");

let batch;
try {
  const file = await json(await fetch(`${baseUrl}/files`, { method: "POST", headers, body: form }));
  batch = await json(await fetch(`${baseUrl}/batches`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ input_file_id: file.id, endpoint: "/v1/chat/completions", completion_window: "24h", metadata: { description: "doubleword-provider smoke" } }),
  }));
  const retrieved = await json(await fetch(`${baseUrl}/batches/${encodeURIComponent(batch.id)}`, { headers }));
  console.log(`live batch smoke passed: file=${file.id} batch=${batch.id} status=${retrieved.status}`);
} finally {
  if (batch?.id) {
    await fetch(`${baseUrl}/batches/${encodeURIComponent(batch.id)}/cancel`, { method: "POST", headers }).catch(() => {});
  }
}
