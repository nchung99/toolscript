const FREE_GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite"
];
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function requestModel(apiKey, model, prompt, variation) {
  const temperature = variation === "high" ? 1.05 : variation === "low" ? 0.45 : 0.75;
  let response;

  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            responseMimeType: "application/json"
          }
        })
      }
    );
  } catch (_) {
    const e = new Error("Không kết nối được Gemini.");
    e.retryable = true;
    throw e;
  }

  let data = {};
  try { data = await response.json(); } catch (_) {}

  if (!response.ok) {
    const msg = data?.error?.message || `HTTP ${response.status}`;
    const e = new Error(msg);
    e.status = response.status;
    e.retryable = RETRYABLE.has(response.status) ||
      /high demand|overload|temporar|try again|resource exhausted|unavailable/i.test(msg);
    throw e;
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map(p => p.text || "").join("").trim();

  if (!text) {
    const e = new Error("Gemini không trả về nội dung.");
    e.retryable = true;
    throw e;
  }

  return text;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Chưa cấu hình GEMINI_API_KEY trên Vercel."
    });
  }

  const { prompt, model, variation } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Thiếu prompt." });
  }
  if (prompt.length > 30000) {
    return res.status(400).json({ error: "Prompt quá dài." });
  }

  const selected = FREE_GEMINI_MODELS.includes(model) ? model : FREE_GEMINI_MODELS[0];
  const queue = [selected, ...FREE_GEMINI_MODELS.filter(m => m !== selected)];
  const delays = [0, 1200, 3000];

  for (const currentModel of queue) {
    for (const delay of delays) {
      if (delay) await sleep(delay);
      try {
        const text = await requestModel(apiKey, currentModel, prompt, variation);
        return res.status(200).json({ text, model: currentModel });
      } catch (e) {
        if (!e.retryable) {
          return res.status(e.status || 500).json({ error: e.message });
        }
      }
    }
  }

  return res.status(503).json({
    error: "Gemini đang bận hoặc vượt giới hạn tạm thời. Thử lại sau."
  });
};
