import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

async function safeJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

const prompts = {
  product: "Write a compelling 3-sentence product description for Lucky Tassel's handmade silk tassel keychain. SEO-optimised, warm and playful tone. Reply with ONLY the description text.",
  blog: "Write a 4-sentence intro for a Lucky Tassel blog post titled 5 Ways to Style Tassels This Season. Fun trend-aware tone. Reply with ONLY the paragraph.",
  homepage: "Write a 2-line hero tagline for Lucky Tassel's homepage. Line 1 bold headline max 6 words. Line 2 subheadline max 12 words. Reply with ONLY the two lines.",
  policy: "Write a 3-sentence returns policy intro for Lucky Tassel a handmade accessories brand. Friendly and clear. Reply with ONLY the paragraph."
};

app.post('/api/generate', async (req, res) => {
  const { agentType } = req.body;
  const prompt = prompts[agentType];
  if (!prompt) return res.status(400).json({ error: 'Invalid agent type' });
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    const text = data.content?.map(b => b.text || '').join('') || '';
    console.log('Generated text:', text);
    console.log('Full response:', JSON.stringify(data));
    res.json({ result: text });
  } catch (err) {
    res.status(500).json({ error: 'Generation failed' });
  }
});

app.post('/api/push', async (req, res) => {
  const { agentType, content, shopifyToken, storeUrl } = req.body;
  if (!shopifyToken || !storeUrl) return res.status(400).json({ error: 'Missing credentials' });

  // Strip any accidental protocol prefix the user may have typed
  const cleanStore = storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const base = `https://${cleanStore}/admin/api/2024-10`;

  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': shopifyToken
  };

  try {
    let ok = false;
    if (agentType === 'product') {
      // Use status=any so draft/archived products are also returned
      const r1 = await fetch(`${base}/products.json?limit=1&status=any`, { headers });
      const d1 = await safeJson(r1);
      console.log('Shopify products response status:', r1.status);
      console.log('Shopify products response body:', JSON.stringify(d1));

      const pid = d1.products?.[0]?.id;
      if (!pid) {
        const detail = d1.errors || d1.error || 'No products returned';
        return res.status(404).json({ error: 'No products found', detail });
      }

      const r2 = await fetch(`${base}/products/${pid}.json`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ product: { id: pid, body_html: `<p>${content}</p>` } })
      });
      const d2 = await safeJson(r2);
      console.log('Shopify update response status:', r2.status);
      console.log('Shopify update response body:', JSON.stringify(d2));
      ok = r2.ok;
      if (!ok) return res.status(500).json({ error: 'Shopify rejected the update', detail: d2.errors || d2.error });
    } else if (agentType === 'blog') {
      const r1 = await fetch(`${base}/blogs.json`, { headers });
      const d1 = await safeJson(r1);
      console.log('Shopify blogs response status:', r1.status);
      console.log('Shopify blogs response body:', JSON.stringify(d1));

      const bid = d1.blogs?.[0]?.id;
      if (!bid) {
        const detail = d1.errors || d1.error || 'No blogs returned';
        return res.status(404).json({ error: 'No blog found', detail });
      }

      const r2 = await fetch(`${base}/blogs/${bid}/articles.json`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          article: {
            title: '5 Ways to Style Tassels This Season',
            body_html: `<p>${content}</p>`,
            published: false
          }
        })
      });
      const d2 = await safeJson(r2);
      console.log('Shopify article create status:', r2.status, JSON.stringify(d2));
      ok = r2.ok;
      if (!ok) return res.status(500).json({ error: 'Shopify rejected the article', detail: d2.errors || d2.error });
    } else if (agentType === 'policy') {
      const r1 = await fetch(`${base}/pages.json`, { headers });
      const d1 = await safeJson(r1);
      console.log('Shopify pages response status:', r1.status);
      console.log('Shopify pages response body:', JSON.stringify(d1));

      const page = d1.pages?.find(p => p.handle === 'returns' || p.handle === 'refund-policy' || p.handle === 'faq');
      if (page) {
        const r2 = await fetch(`${base}/pages/${page.id}.json`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ page: { id: page.id, body_html: `<p>${content}</p>` } })
        });
        const d2 = await safeJson(r2);
        console.log('Shopify page update status:', r2.status, JSON.stringify(d2));
        ok = r2.ok;
        if (!ok) return res.status(500).json({ error: 'Shopify rejected the page update', detail: d2.errors || d2.error });
      } else {
        const r2 = await fetch(`${base}/pages.json`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ page: { title: 'Returns & FAQ', body_html: `<p>${content}</p>`, published: true } })
        });
        const d2 = await safeJson(r2);
        console.log('Shopify page create status:', r2.status, JSON.stringify(d2));
        ok = r2.ok;
        if (!ok) return res.status(500).json({ error: 'Shopify rejected page creation', detail: d2.errors || d2.error });
      }
    } else if (agentType === 'homepage') {
      return res.json({ success: true, note: 'Paste into Shopify theme editor hero section.' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Push error:', err);
    res.status(500).json({ error: 'Push failed: ' + err.message });
  }
});

// Test endpoint — checks Shopify credentials and scopes without modifying anything
app.post('/api/test-connection', async (req, res) => {
  const { shopifyToken, storeUrl } = req.body;
  if (!shopifyToken || !storeUrl) return res.status(400).json({ error: 'Missing credentials' });

  const cleanStore = storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const base = `https://${cleanStore}/admin/api/2024-10`;
  const headers = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': shopifyToken };

  const results = {};
  for (const [name, path] of [['shop', '/shop.json'], ['products', '/products.json?limit=1&status=any'], ['blogs', '/blogs.json']]) {
    try {
      const r = await fetch(`${base}${path}`, { headers });
      const body = await safeJson(r);
      results[name] = { status: r.status, ok: r.ok, body };
    } catch (e) {
      results[name] = { error: e.message };
    }
  }
  res.json(results);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Lucky Tassel agents running on port ${PORT}`));
