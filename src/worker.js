export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('OK');

    const update = await request.json();
    const message = update.message?.text;
    const chatId = update.message?.chat.id;

    if (!message) return new Response('OK');

    try {
      if (message.toLowerCase().startsWith('/start')) {
        await sendTelegram(chatId, 'NutriTrack AI ready! Send food or "water 500ml" or "supplement vitaminC"', env);

      } else if (message.toLowerCase().includes('water') || message.includes('ml')) {
        await logWater(message, env);
        await sendTelegram(chatId, '💧 Water logged!', env);

      } else if (message.toLowerCase().includes('supplement')) {
        await logSupplement(message, env);
        await sendTelegram(chatId, '💊 Supplement logged!', env);

      } else if (message.toLowerCase().startsWith('/template')) {
        await saveTemplate(message, env);
        await sendTelegram(chatId, '📋 Template saved!', env);

      } else {
        const nutrition = await getNutrition(message, env);
        await logToNotion(nutrition, message, env);
        await sendTelegram(chatId,
          `✅ Logged: ${message}\n${nutrition.Calories} cal | P:${nutrition.Protein_g}g C:${nutrition.Carbs_g}g F:${nutrition.Fats_g}g | Fiber:${nutrition.Fiber_g}g\nConfidence: ${nutrition.confidence}`,
          env
        );
      }
    } catch (e) {
      await sendTelegram(chatId, '❌ Error: ' + e.message, env);
    }

    return new Response('OK');
  }
};

// ─── Gemini Nutrition Analysis ───────────────────────────────────────────────

async function getNutrition(food, env) {
  const prompt = `Analyze this Indian food item: "${food}".
Return ONLY valid JSON with no explanation, no markdown, no backticks:
{"Calories":0,"Protein_g":0,"Carbs_g":0,"Fats_g":0,"Fiber_g":0,"confidence":"High"}
Confidence must be one of: High, Medium, Low.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    }
  );

  const data = await response.json();
  const text = data.candidates[0].content.parts[0].text
    .replace(/```json|```/g, '')
    .trim();
  return JSON.parse(text);
}

// ─── Log Food to Daily Nutrition Log ─────────────────────────────────────────

async function logToNotion(nutrition, foodText, env) {
  const now = new Date();
  const hour = now.getHours();
  const mealType = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Night';
  const dateStr = now.toISOString().split('T')[0];
  const readableDate = now.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });

  await notionPost('pages', {
    parent: { database_id: env.DAILY_ID },
    properties: {
      'Name':        { title: [{ text: { content: `${mealType} - ${readableDate}` } }] },
      'Meal Des...': { rich_text: [{ text: { content: foodText } }] },
      'Meal Type':   { select: { name: mealType } },
      'Calories':    { number: nutrition.Calories },
      'Protein_g':   { number: nutrition.Protein_g },
      'Carbs_g':     { number: nutrition.Carbs_g },
      'Fats_g':      { number: nutrition.Fats_g },
      'Fiber_g':     { number: nutrition.Fiber_g },
      'Date':        { date: { start: dateStr } },
      'Timestamp':   { date: { start: now.toISOString() } },
      'Confiden...': { select: { name: nutrition.confidence } },
      'Notes':       { rich_text: [{ text: { content: 'Logged via Telegram' } }] }
    }
  }, env);
}

// ─── Log Water to Water & Weight Log ─────────────────────────────────────────

async function logWater(text, env) {
  const amount = parseInt(text.match(/\d+/)?.[0] || '250');
  const now = new Date();

  await notionPost('pages', {
    parent: { database_id: env.WATER_ID },
    properties: {
      'Name':      { title: [{ text: { content: 'Water' } }] },
      'Amount_ml': { number: amount },
      'Date':      { date: { start: now.toISOString().split('T')[0] } }
    }
  }, env);
}

// ─── Log Supplement to Supplements Log ───────────────────────────────────────

async function logSupplement(text, env) {
  const name = text.replace(/supplement/i, '').trim() || 'Supplement';
  const now = new Date();

  await notionPost('pages', {
    parent: { database_id: env.SUPP_ID },
    properties: {
      'Name': { title: [{ text: { content: name } }] },
      'Date': { date: { start: now.toISOString().split('T')[0] } }
    }
  }, env);
}

// ─── Save Meal Template ───────────────────────────────────────────────────────

async function saveTemplate(text, env) {
  const templateName = text.replace(/\/template/i, '').trim() || 'My Template';

  await notionPost('pages', {
    parent: { database_id: env.TEMPLATE_ID },
    properties: {
      'Name': { title: [{ text: { content: templateName } }] }
    }
  }, env);
}

// ─── Notion Helper ────────────────────────────────────────────────────────────

async function notionPost(endpoint, body, env) {
  const res = await fetch(`https://api.notion.com/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Notion error: ${err.message}`);
  }

  return res.json();
}

// ─── Telegram Helper ──────────────────────────────────────────────────────────

async function sendTelegram(chatId, text, env) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}
