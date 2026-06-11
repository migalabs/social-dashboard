const BASE_URL = process.env.TWITTERAPI_BASE_URL || 'https://api.twitterapi.io';

function buildUrl(path, query = {}) {
  const url = new URL(path, BASE_URL);

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    url.searchParams.append(key, String(value));
  });

  return url;
}

async function twitterApiGet(path, query = {}) {
  const apiKey = process.env.TWITTERAPI_API_KEY;
  if (!apiKey) {
    const error = new Error('Missing TWITTERAPI_API_KEY in backend environment');
    error.status = 500;
    throw error;
  }

  const url = buildUrl(path, query);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-API-Key': apiKey,
    },
  });

  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_error) {
    payload = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`Twitter API request failed with status ${response.status}`);
    error.status = response.status;
    error.upstream = payload;
    throw error;
  }

  return payload;
}

module.exports = {
  twitterApiGet,
};
