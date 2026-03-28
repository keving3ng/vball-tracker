let cachedToken: string | null = null;
let tokenExpiry: number = 0;

function getTokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return payload.exp * 1000;
  } catch {
    // If JWT parsing fails, treat token as expiring in 55 minutes (conservative)
    return Date.now() + 55 * 60 * 1000;
  }
}

export async function getValidToken(): Promise<string> {
  const now = Date.now();
  const fiveMin = 5 * 60 * 1000;

  if (cachedToken && tokenExpiry - now > fiveMin) {
    return cachedToken;
  }

  const refreshToken = process.env.PARTIFUL_REFRESH_TOKEN;
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!refreshToken || !apiKey) {
    throw new Error('PARTIFUL_REFRESH_TOKEN and FIREBASE_API_KEY must be set in .env');
  }

  const res = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://partiful.com',
        'Origin': 'https://partiful.com',
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.id_token) {
    throw new Error(`Token refresh returned no id_token: ${JSON.stringify(data).slice(0, 200)}`);
  }
  cachedToken = data.id_token;
  tokenExpiry = getTokenExpiry(cachedToken!);
  return cachedToken!;
}
