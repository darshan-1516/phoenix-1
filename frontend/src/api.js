const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function formatDetail(detail) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((issue) => {
      if (typeof issue === "string") return issue;
      if (!issue || typeof issue !== "object") return String(issue);
      const location = Array.isArray(issue.loc)
        ? issue.loc.slice(1).reduce((path, part) => (
          typeof part === "number" ? `${path}[${part}]` : `${path}${path ? "." : ""}${part}`
        ), "")
        : "";
      return [location, issue.msg || issue.message].filter(Boolean).join(": ") || JSON.stringify(issue);
    }).join("; ");
  }
  if (detail && typeof detail === "object") {
    if (typeof detail.message === "string") return detail.message;
    return JSON.stringify(detail);
  }
  return "";
}

export async function api(path, { token, ...options } = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    throw new Error(`Could not reach the API at ${API_URL}. Check that the backend is running and accessible. ${error.message}`);
  }
  const responseText = await response.text();
  let data = {};
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { detail: responseText };
    }
  }
  if (!response.ok) {
    throw new Error(formatDetail(data.detail) || `Request failed (${response.status})`);
  }
  return data;
}

export { API_URL };
