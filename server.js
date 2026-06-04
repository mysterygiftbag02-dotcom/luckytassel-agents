import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    const text = data.content?.map(b => b.text || '').join('') || '';
    console.log('Generated text:', text);
    console.log('Generated text1:', text);
    console.log('Full response:', JSON.stringify(data));
    res.json({ result: text });
  } catch (err) {
    res.status(500).json({ error: 'Generation failed' });
  }
});

app.post('/api/push', async (req, res) => {
  const { agentType, content, shopifyToken, storeUrl } = req.body;
  if (!shopifyToken || !storeUrl) return res.status(400).json({ error: 'Missing credentials' });
  const base = `https://${storeUrl}/admin/api/2024-01`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': shopifyToken
  };
  try {
    let ok = false;
    if (agentType === 'product') {
      const r1 = await fetch(`${base}/products.json?limit=1`, { headers });
      const d1 = await r1.json();
      const pid = d1.products?.[0]?.id;
      if (!pid) return res.status(404).json({ error: 'No products found' });
      const r2 = await fetch(`${base}/products/${pid}.json`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ product: { id: pid, body_html: `<p>${content}</p>` } })
      });
      ok = r2.ok;
    } else if (agentType === 'blog') {
      const r1 = await fetch(`${base}/blogs.json`, { headers });
      const d1 = await r1.json();
      const bid = d1.blogs?.[0]?.id;
      if (!bid) return res.status(404).json({ error: 'No blog found' });
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
      ok = r2.ok;
    } else if (agentType === 'policy') {
      const r1 = await fetch(`${base}/pages.json`, { headers });
      const d1 = await r1.json();
      const page = d1.pages?.find(p => p.handle === 'returns' || p.handle === 'refund-policy' || p.handle === 'faq');
      if (page) {
        const r2 = await fetch(`${base}/pages/${page.id}.json`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ page: { id: page.id, body_html: `<p>${content}</p>` } })
        });
        ok = r2.ok;
      } else {
        const r2 = await fetch(`${base}/pages.json`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ page: { title: 'Returns & FAQ', body_html: `<p>${content}</p>`, published: true } })
        });
        ok = r2.ok;
      }
    } else if (agentType === 'homepage') {
      return res.json({ success: true, note: 'Paste into Shopify theme editor hero section.' });
    }
    if (ok) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Shopify rejected the request' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Push failed: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Lucky Tassel agents running on port ${PORT}`));
