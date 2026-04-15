# n8n-nodes-rendex

> n8n community node for [Rendex](https://rendex.dev) — capture screenshots, generate PDFs, and render HTML to images via the Rendex rendering API.

[![npm version](https://img.shields.io/npm/v/n8n-nodes-rendex)](https://www.npmjs.com/package/n8n-nodes-rendex)
[![license](https://img.shields.io/npm/l/n8n-nodes-rendex)](LICENSE)

This is a community node for [n8n](https://n8n.io), the fair-code workflow automation platform. It lets your workflows talk to [api.rendex.dev](https://api.rendex.dev) to render web pages and raw HTML into high-quality PNG, JPEG, WebP, or PDF output.

---

## Features

- **Capture screenshots** of live URLs or raw HTML (up to 5 MB of HTML)
- **Generate PDFs** with configurable page size, margins, landscape, and scale
- **Async mode** — submit a capture and receive an HMAC-signed webhook when it's done
- **Batch mode** — submit up to 500 URLs in a single request (plan-dependent)
- **Geo-targeted captures** — render pages as seen from a specific country, city, or state *(Pro/Enterprise)*
- **Element capture** — screenshot a specific CSS selector instead of the full page
- **Ad blocking**, resource blocking, CSS/JS injection, cookie injection, custom headers, dark mode emulation, full-page auto-scroll

Rendex is built on Cloudflare Workers with Browser Rendering and backs a live v1.0.0 production API. See [rendex.dev/docs](https://rendex.dev/docs) for full API documentation.

---

## Installation

### n8n Cloud & self-hosted

1. Open your n8n instance → **Settings → Community Nodes**
2. Click **Install** and paste: `n8n-nodes-rendex`
3. Accept the community-node warning and click **Install**
4. Once installed, add a **Rendex** node to any workflow

### Manual (npm)

```bash
npm install n8n-nodes-rendex
```

---

## Authentication

1. Sign in to [rendex.dev/dashboard](https://rendex.dev/dashboard) (free plan available)
2. Go to **API Keys** and click **Create Key**
3. Copy the key — it starts with `rdx_`
4. In n8n, create a new **Rendex API** credential and paste the key into the **API Key** field

Rendex keys are bearer tokens sent as `Authorization: Bearer rdx_...`. The node handles the header automatically.

---

## Operations

### Screenshot

| Operation | What it does |
|---|---|
| **Capture** | Sync request that returns an image or PDF. Output is written to the node's binary property (default `data`) plus a JSON metadata object. |
| **Capture Async** | Submits a job and returns immediately with a `jobId`. Optional `webhookUrl` is called with an HMAC-signed payload when the capture completes. |

### Job

| Operation | What it does |
|---|---|
| **Get Status** | Polls an async job by `jobId` and returns its current status + signed result URL once ready. |

### Batch

| Operation | What it does |
|---|---|
| **Submit** | Submits up to 500 URLs for parallel capture. Accepts per-URL defaults and an optional completion webhook. |
| **Get Status** | Polls a batch by `batchId` and returns status + all child job results. |

---

## Example: sync capture

1. Add a **Rendex** node after any trigger
2. Set **Resource** = `Screenshot`, **Operation** = `Capture`
3. Set **Source** = `URL` and enter `https://example.com`
4. Leave **Format** = `png`
5. Click **Execute Node** — the output tab shows the metadata JSON and the binary `data` property holds the PNG. Wire it into **Write Binary File**, **Upload to S3**, **HTTP Request** (to forward it), or any other binary-capable node.

## Example: async + webhook trigger

1. Add a **Rendex** node, set **Operation** = `Capture Async`
2. Paste a webhook URL in the **Webhook URL** field (use another workflow's **Webhook** node production URL)
3. Execute. The first workflow returns immediately with the `jobId`.
4. In the receiving workflow, verify the HMAC signature on the `rendex-signature` header, then download the signed result URL from the payload.

## Example: batch of URLs

1. Add a **Rendex** node, set **Resource** = `Batch`, **Operation** = `Submit`
2. Paste one URL per line in the **URLs** field
3. Fill **Defaults (JSON)** with shared options, e.g. `{"format":"png","fullPage":true}`
4. Execute — you get back a `batchId` and the list of queued jobs
5. Wire a **Schedule Trigger** or **Wait** node to another **Rendex** node with **Resource** = `Batch`, **Operation** = `Get Status` to poll completion.

---

## Plan limits

| Limit | Free | Starter | Pro | Enterprise |
|---|---|---|---|---|
| Rate limit (req/min) | 10 | 60 | 300 | 1000 |
| Batch size | 5 | 25 | 100 | 500 |
| Concurrent async jobs | 10 | 50 | 200 | 1000 |
| Geo-targeting | — | — | ✓ | ✓ |

See [rendex.dev/pricing](https://rendex.dev/pricing) for current pricing.

---

## Advanced options

The **Capture** and **Capture Async** operations expose an **Additional Options** collection with the full Rendex v1.0.0 parameter surface:

- **Viewport**: Width, Height, Device Scale Factor, Full Page, Dark Mode
- **Output**: Quality (for JPEG/WebP)
- **Wait strategy**: Wait Until, Timeout, Delay, Wait For Selector, Best Attempt
- **Element capture**: Element Selector
- **Blocking**: Block Ads, Block Resource Types
- **Injection**: Custom CSS, Custom JavaScript, Custom Headers (JSON), Cookies (JSON), User Agent
- **PDF**: PDF Page Format, PDF Landscape, PDF Print Background, PDF Scale, PDF Margins (JSON)
- **Geo-targeting**: Geo Country, Geo City, Geo State *(Pro/Enterprise)*
- **Async**: Cache TTL

Everything maps 1:1 to the [REST API parameters](https://rendex.dev/docs/api-reference).

---

## Support

- **Docs**: [rendex.dev/docs](https://rendex.dev/docs)
- **Issues**: [github.com/copperline-labs/rendex-n8n/issues](https://github.com/copperline-labs/rendex-n8n/issues)
- **Email**: [support@rendex.dev](mailto:support@rendex.dev)

## License

MIT © Copperline Labs LLC
