/**
 * POST /api/teach-label — the app's ONLY server component.
 *
 * Receives one downscaled label photo (+ optional hint), calls the Claude
 * vision API once, and returns the structured TeachResult JSON. Called only
 * from the "Teach a new label" flow in Label Intelligence — once per label
 * design, never per carton, never from the receiving flow.
 *
 * Secrets live in Vercel environment variables, never in the client bundle:
 *   ANTHROPIC_API_KEY   — Claude API key
 *   TEACH_SHARED_SECRET — must equal the value baked into src/lib/teach.ts;
 *                         requests without the matching x-teach-secret header
 *                         are rejected (basic guard so the public URL can't be
 *                         farmed as a free AI proxy)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  TEACH_OUTPUT_SCHEMA,
  TEACH_PROMPT,
  TEACH_SECRET_HEADER,
  extractTeachJson,
  validateTeachRequest,
  type TeachRequestBody,
  // NB: the .js extension is required — the project is ESM ("type": "module"),
  // and the Vercel Node runtime resolves relative imports per ESM rules.
} from '../src/lib/teachShared.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-8';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const secret = process.env.TEACH_SHARED_SECRET;
  if (!apiKey || !secret) {
    res.status(500).json({
      error: 'Teach service not configured — set ANTHROPIC_API_KEY and TEACH_SHARED_SECRET in Vercel',
    });
    return;
  }

  if (req.headers[TEACH_SECRET_HEADER] !== secret) {
    res.status(401).json({ error: 'Unauthorised' });
    return;
  }

  const invalid = validateTeachRequest(req.body);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const { image, mediaType, hint } = req.body as TeachRequestBody;

  const userText = hint?.trim()
    ? `${TEACH_PROMPT}\n\nHint from the operator about this label: ${hint.trim()}`
    : TEACH_PROMPT;

  try {
    const aiRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        output_config: { format: { type: 'json_schema', schema: TEACH_OUTPUT_SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
              { type: 'text', text: userText },
            ],
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      const detail = await aiRes.text().catch(() => '');
      console.error('Claude API error', aiRes.status, detail.slice(0, 500));
      res.status(502).json({
        error:
          aiRes.status === 401
            ? 'AI key rejected — check ANTHROPIC_API_KEY in Vercel'
            : `AI service error (${aiRes.status}) — try again`,
      });
      return;
    }

    const message = (await aiRes.json()) as {
      stop_reason?: string;
      content?: Array<{ type: string; text?: string }>;
    };

    if (message.stop_reason === 'refusal') {
      res.status(502).json({ error: 'The AI declined to analyse this image — try a clearer photo of the label' });
      return;
    }
    if (message.stop_reason === 'max_tokens') {
      res.status(502).json({ error: 'AI response was cut short — try again' });
      return;
    }

    const text = message.content?.find((b) => b.type === 'text')?.text;
    if (!text) {
      res.status(502).json({ error: 'AI returned no analysis — try again' });
      return;
    }

    res.status(200).json({ ok: true, result: extractTeachJson(text) });
  } catch (err) {
    console.error('teach-label failed', err);
    res.status(502).json({ error: 'Label analysis failed — check connectivity and try again' });
  }
}
