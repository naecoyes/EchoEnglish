const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

async function searchTopicContext({ topic, apiKey, maxResults = 6, searchHint = "" } = {}) {
  const cleanTopic = cleanText(topic);
  const key = cleanText(apiKey);
  if (!key) {
    throw new Error("Tavily API key is required for search-backed story planning. Open Settings and save a Tavily API key.");
  }
  if (!cleanTopic) {
    throw new Error("A story topic is required before search.");
  }

  const query = [
    cleanTopic,
    cleanText(searchHint),
    "reliable sources, clear explanation, key facts, practical examples, beginner-friendly background"
  ].join(" ");

  const payload = await callTavilySearch({
    apiKey: key,
    query,
    maxResults
  });

  return normalizeSearchResponse(payload, query);
}

async function testTavilySearch(apiKey) {
  const key = cleanText(apiKey);
  if (!key) {
    return { ok: false, error: "Tavily API key is missing." };
  }

  try {
    const result = await callTavilySearch({
      apiKey: key,
      query: "EchoEnglish search connection test",
      maxResults: 1
    });
    if (!Array.isArray(result?.results)) {
      return { ok: false, error: "Tavily response did not include results." };
    }
    return { ok: true, message: "Tavily search API key is valid." };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function callTavilySearch({ apiKey, query, maxResults }) {
  const body = {
    query,
    search_depth: "basic",
    include_answer: true,
    include_raw_content: false,
    max_results: Math.max(1, Math.min(8, Number(maxResults || 6)))
  };

  const primary = await postSearch(apiKey, body, false);
  if (primary.ok) return primary.payload;

  if ([401, 403].includes(primary.status)) {
    const fallback = await postSearch(apiKey, body, true);
    if (fallback.ok) return fallback.payload;
    throw new Error(formatTavilyError(fallback.status, fallback.payload));
  }

  throw new Error(formatTavilyError(primary.status, primary.payload));
}

async function postSearch(apiKey, body, includeApiKeyInBody) {
  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(includeApiKeyInBody ? { ...body, api_key: apiKey } : body)
  });
  const payload = await response.json().catch(() => null);
  return {
    ok: response.ok,
    status: response.status,
    payload
  };
}

function normalizeSearchResponse(payload, query) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return {
    source: "tavily",
    query: cleanText(payload?.query) || query,
    answer: trimTo(cleanText(payload?.answer), 900),
    results: results.map(normalizeResult).filter((result) => result.title || result.url || result.content).slice(0, 8),
    searchedAt: new Date().toISOString()
  };
}

function normalizeResult(result) {
  return {
    title: trimTo(cleanText(result?.title), 180),
    url: trimTo(cleanText(result?.url), 600),
    content: trimTo(cleanText(result?.content), 900),
    score: Number.isFinite(Number(result?.score)) ? Number(result.score) : null
  };
}

function formatSearchContext(context) {
  if (!context || typeof context !== "object") return "No web search context.";
  const lines = [
    `Search provider: ${context.source || "tavily"}`,
    `Search query: ${context.query || ""}`,
    context.answer ? `Search answer: ${context.answer}` : ""
  ].filter(Boolean);

  (context.results || []).slice(0, 6).forEach((result, index) => {
    lines.push([
      `Source ${index + 1}: ${result.title || "Untitled"}`,
      result.url ? `URL: ${result.url}` : "",
      result.content ? `Summary: ${result.content}` : ""
    ].filter(Boolean).join("\n"));
  });

  return lines.join("\n\n").slice(0, 9000);
}

function formatTavilyError(status, payload) {
  const message = payload?.error
    || payload?.message
    || payload?.detail
    || payload?.base_resp?.status_msg
    || "Tavily search request failed.";
  return `Tavily returned HTTP ${status}. ${message}`;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function trimTo(value, maxLength) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

module.exports = {
  TAVILY_SEARCH_URL,
  formatSearchContext,
  searchTopicContext,
  testTavilySearch
};
