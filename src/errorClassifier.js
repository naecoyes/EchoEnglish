function classifyError(error) {
  const message = String(error?.message || error || "");
  const lower = message.toLowerCase();

  if (/rate limit|too many requests|http 429|rpm|tpm|qps/.test(lower)) {
    return { type: "rate_limit", recoverable: true };
  }
  if (/quota|insufficient|balance|limit exceeded|credit/.test(lower)) {
    return { type: "quota_exceeded", recoverable: true };
  }
  if (/unauthorized|forbidden|invalid api key|api key|http 401|http 403/.test(lower)) {
    return { type: "auth_error", recoverable: false };
  }
  if (/http 5\d\d|econnreset|etimedout|enotfound|network|fetch failed/.test(lower)) {
    return { type: "network_error", recoverable: true };
  }
  if (/bad request|invalid|http 400|http 404/.test(lower)) {
    return { type: "bad_request", recoverable: false };
  }

  return { type: "server_error", recoverable: true };
}

module.exports = {
  classifyError
};
