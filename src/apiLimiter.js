const queues = new Map();
const lastCallAt = new Map();

const DEFAULT_POLICIES = {
  "minimax:tts": { minIntervalMs: 3500, retries: 5, timeoutMs: 120000 },
  "minimax:image": { minIntervalMs: 3000, retries: 8, timeoutMs: 180000 },
  "minimax:music": { minIntervalMs: 2200, retries: 4, timeoutMs: 180000 },
  "google:tts": { minIntervalMs: 1600, retries: 6, timeoutMs: 90000 },
  "google:image": { minIntervalMs: 4200, retries: 8, timeoutMs: 120000 },
  "xiaomi:tts": { minIntervalMs: 3500, retries: 5, timeoutMs: 90000 },
  "llm:text": { minIntervalMs: 1000, retries: 3, timeoutMs: 600000 },
  "tavily:search": { minIntervalMs: 1000, retries: 3, timeoutMs: 45000 },
  "download:image": { minIntervalMs: 150, retries: 5, timeoutMs: 60000 }
};

async function fetchJsonWithPolicy(policyKey, url, options = {}, overrides = {}) {
  const response = await fetchWithPolicy(policyKey, url, options, overrides);
  const text = await response.text();
  const payload = parseJson(text);
  if (!response.ok) {
    throw httpError(policyKey, response.status, payload, text);
  }
  return payload;
}

async function fetchBufferWithPolicy(policyKey, url, options = {}, overrides = {}) {
  const response = await fetchWithPolicy(policyKey, url, options, overrides);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw httpError(policyKey, response.status, parseJson(text), text);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function fetchWithPolicy(policyKey, url, options = {}, overrides = {}) {
  return enqueue(policyKey, async () => {
    const policy = resolvePolicy(policyKey, overrides);
    let lastError = null;

    for (let attempt = 0; attempt < policy.retries; attempt += 1) {
      await waitForSlot(policyKey, policy.minIntervalMs);
      try {
        const response = await fetchWithTimeout(url, options, policy.timeoutMs);
        if (isRetryableStatus(response.status)) {
          const text = await response.clone().text().catch(() => "");
          const parsedError = httpError(policyKey, response.status, parseJson(text), text);
          if (parsedError.message.includes("quota_exceeded")) {
            return response; // Pass through to caller to throw immediately without retrying
          }
          const retryAfterMs = retryAfterToMs(response.headers.get("retry-after"));
          lastError = parsedError;
          await delay(retryAfterMs || backoffMs(attempt, policy));
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt >= policy.retries - 1) break;
        await delay(backoffMs(attempt, policy));
      }
    }

    throw lastError || new Error(`${policyKey} request failed.`);
  });
}

function enqueue(policyKey, task) {
  const previous = queues.get(policyKey) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  const cleanup = next.catch(() => {}).then(() => {
    if (queues.get(policyKey) === cleanup) queues.delete(policyKey);
  });
  queues.set(policyKey, cleanup);
  return next;
}

async function waitForSlot(policyKey, minIntervalMs) {
  if (!minIntervalMs) return;
  const now = Date.now();
  const elapsed = now - (lastCallAt.get(policyKey) || 0);
  const waitMs = minIntervalMs - elapsed;
  if (waitMs > 0) await delay(waitMs);
  lastCallAt.set(policyKey, Date.now());
}

function resolvePolicy(policyKey, overrides) {
  const defaults = DEFAULT_POLICIES[policyKey] || { minIntervalMs: 1000, retries: 3 };
  return {
    minIntervalMs: Number.isFinite(Number(overrides.minIntervalMs))
      ? Math.max(0, Number(overrides.minIntervalMs))
      : defaults.minIntervalMs,
    retries: Number.isFinite(Number(overrides.retries))
      ? Math.max(1, Number(overrides.retries))
      : defaults.retries,
    backoffBaseMs: Number.isFinite(Number(overrides.backoffBaseMs))
      ? Math.max(250, Number(overrides.backoffBaseMs))
      : 1400,
    timeoutMs: Number.isFinite(Number(overrides.timeoutMs))
      ? Math.max(1000, Number(overrides.timeoutMs))
      : defaults.timeoutMs || 90000
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: options.signal || controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function retryAfterToMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function backoffMs(attempt, policy) {
  return policy.backoffBaseMs * (attempt + 1) + Math.round(Math.random() * 250);
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function httpError(policyKey, status, payload, text) {
  const provider = policyKey.split(":")[0] || "API";
  const bodyMessage = payload?.error?.message
    || payload?.message
    || payload?.base_resp?.status_msg
    || payload?.msg
    || String(text || "").replace(/\s+/g, " ").trim().slice(0, 220);
  if (status === 429) {
    return new Error(`${provider} rate_limit HTTP 429${bodyMessage ? `: ${bodyMessage}` : ""}`);
  }
  if (status === 402 || /quota|insufficient|balance|credit/i.test(bodyMessage)) {
    return new Error(`${provider} quota_exceeded HTTP ${status}${bodyMessage ? `: ${bodyMessage}` : ""}`);
  }
  if (status === 401 || status === 403) {
    return new Error(`${provider} auth_error HTTP ${status}${bodyMessage ? `: ${bodyMessage}` : ""}`);
  }
  if (status >= 500) {
    return new Error(`${provider} server_error HTTP ${status}${bodyMessage ? `: ${bodyMessage}` : ""}`);
  }
  return new Error(`${provider} bad_request HTTP ${status}${bodyMessage ? `: ${bodyMessage}` : ""}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  fetchBufferWithPolicy,
  fetchJsonWithPolicy,
  fetchWithPolicy
};
