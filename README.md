# n8n-nodes-rendex

> n8n community node for [Rendex](https://rendex.dev) — capture screenshots, generate PDFs, render HTML and Markdown to images, and extract clean content from URLs via the Rendex rendering API.

[![npm version](https://img.shields.io/npm/v/n8n-nodes-rendex)](https://www.npmjs.com/package/n8n-nodes-rendex)
[![license](https://img.shields.io/npm/l/n8n-nodes-rendex)](LICENSE)

This is a community node for [n8n](https://n8n.io), the fair-code workflow automation platform. It lets your workflows talk to [api.rendex.dev](https://api.rendex.dev) to render web pages, raw HTML, and Markdown into high-quality PNG, JPEG, WebP, or PDF output.

---

## Features

- **Capture screenshots** of live URLs, raw HTML, or Markdown (up to 5 MB of HTML/Markdown)
- **Extract content** — turn any URL into clean reader-mode **Markdown, JSON, or HTML** for LLM and RAG pipelines (Document → Extract)
- **Data templating** — fill `{{placeholders}}` in an HTML or Markdown template from a JSON object (Mustache) to generate invoices, reports, and certificates from one template
- **Generate PDFs** with configurable page size, margins, landscape, and scale
- **Device presets** — render at iPhone, iPad, or Pixel viewports (sets viewport, scale, and user agent in one option)
- **Output resize** — downscale captures to thumbnails, aspect ratio preserved
- **Clean capture** — hide cookie/consent banners and arbitrary CSS selectors before capture
- **Async mode** — submit a capture and receive an HMAC-signed webhook when it's done
- **Batch mode** — submit up to 500 URLs in a single request (plan-dependent)
- **Geo-targeted captures** — render pages as seen from a specific country, city, or state *(Pro/Enterprise)*
- **Element capture** — screenshot a specific CSS selector instead of the full page
- **Watch a page for changes** *(Rendex Watch)* — monitor a URL on a schedule with real-Chrome **visual diff**, text diff, or both; create/list/update/run watches and **trigger a workflow when a page changes** (polling **Rendex Watch Trigger** node)
- **Ad blocking**, resource blocking, CSS/JS injection, cookie injection, custom headers, dark mode emulation, full-page auto-scroll

Rendex is built on Cloudflare Workers with Browser Rendering and backs a live production API. See [rendex.dev/docs](https://rendex.dev/docs) for full API documentation.

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

## Ready-made workflow templates

Skip the blank canvas — import a complete, sticky-noted workflow, add your Rendex
API credential, and run. Download the JSON, then in n8n use **Workflows → Import
from File** (or drag it onto the canvas):

| Template | What it does |
| --- | --- |
| [Invoice → PDF → email](https://rendex.dev/n8n/templates/invoice-html-to-pdf.json) | Render order data into a branded PDF invoice and email it |
| [Watch a page → Slack](https://rendex.dev/n8n/templates/watch-page-to-slack.json) | Monitor any page for changes and post the diff to Slack |
| [Scheduled screenshot → Drive](https://rendex.dev/n8n/templates/screenshot-schedule-archive.json) | Capture a URL on a schedule and archive it to Google Drive |
| [OG image per post](https://rendex.dev/n8n/templates/og-image-render-link.json) | Mint a hosted `og:image` URL for every blog post |
| [Extract URL → AI summary](https://rendex.dev/n8n/templates/extract-url-for-ai.json) | Pull clean Markdown from a page and summarize it with an LLM |
| [Report → branded PDF + link](https://rendex.dev/n8n/templates/artifact-report-to-pdf.json) | Turn Markdown into a branded PDF, PNG, and hosted share page |
| [Bulk screenshots from Sheets](https://rendex.dev/n8n/templates/batch-screenshots-from-sheet.json) | Batch-capture a list of URLs at scale (Starter+) |
| [AI agent render tool](https://rendex.dev/n8n/templates/ai-agent-render-tool.json) | An AI Agent that screenshots/renders pages on demand |
| [Geo screenshot compare](https://rendex.dev/n8n/templates/geo-screenshot-compare.json) | Capture a page from multiple countries and compare (Pro+) |
| [Screenshot behind login](https://rendex.dev/n8n/templates/screenshot-behind-login.json) | Capture an authenticated page using session cookies (Starter+) |

Browse them with previews at **[rendex.dev/docs/n8n#templates](https://rendex.dev/docs/n8n#templates)**.

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

### Document

| Operation | What it does |
|---|---|
| **Extract** | Fetches a URL, runs reader-mode extraction in the fully rendered page (handles JS/SPA pages), and returns clean **Markdown**, **JSON**, or **HTML** — title, byline, excerpt, site name, and content. Ideal for feeding pages to LLM/RAG nodes. |

### Job

| Operation | What it does |
|---|---|
| **Get Status** | Polls an async job by `jobId` and returns its current status + signed result URL once ready. |

### Batch

| Operation | What it does |
|---|---|
| **Submit** | Submits up to 500 URLs for parallel capture. Accepts per-URL defaults and an optional completion webhook. |
| **Get Status** | Polls a batch by `batchId` and returns status + all child job results. |

### Watch (Rendex Watch)

Monitor a URL on a schedule and detect when it changes — real-Chrome **visual** diff (with a highlighted overlay), an extracted-**text** diff, or **both**. Uses your existing `rdx_` key and shared credit pool.

| Operation | What it does |
|---|---|
| **Create** | Start monitoring a URL. Choose the interval, change-detection mode, and (optionally) a webhook/email alert + render knobs (element selector, noise filters, monitor identity). |
| **Get** | Fetch one watch by ID. |
| **Get Many** | List your watches (filter by active/paused) — one output item per watch. |
| **Run Now** | Trigger an immediate check (charges 1 credit). |
| **Update** | Change the URL, interval, mode, alerts, or pause/resume. |
| **Delete** | Remove a watch and its run history. |

> **Plan walls:** the minimum check interval is your plan's floor (Free daily / Basic 3h / Starter 1h / Pro 30 min / Enterprise 5 min). Webhook alerts (Watch, and async/batch completion) need Starter+; email alerts and the visual/text diff work on every plan.

### Rendex Watch Trigger

A separate **trigger** node that starts your workflow when a monitored page changes. It **polls** your watches and fires for any whose last change advanced since the previous poll (leave **Watch ID** empty to fire for any of your watches, or set it to monitor one). For real-time delivery, point a watch's **Webhook URL** at an n8n **Webhook** node instead — this trigger is the zero-config alternative.

---

## Example: sync capture

1. Add a **Rendex** node after any trigger
2. Set **Resource** = `Screenshot`, **Operation** = `Capture`
3. Set **Source** = `URL` and enter `https://example.com`
4. Leave **Format** = `png`
5. Click **Execute Node** — the output tab shows the metadata JSON and the binary `data` property holds the PNG. Wire it into **Write Binary File**, **Upload to S3**, **HTTP Request** (to forward it), or any other binary-capable node.

## Example: data templating (invoice from a template)

1. Add a **Rendex** node, set **Operation** = `Capture`
2. Set **Source** = `HTML` (or `Markdown`) and enter a template with Mustache placeholders, e.g. `<h1>Invoice {{number}}</h1><p>Total: {{total}}</p>`
3. Set **Format** = `pdf`
4. Fill the **Template Data (JSON)** field with the values to inject, e.g. `{"number":"INV-014","total":"$2,400"}`
5. Execute — Rendex renders the template with your data and returns the PDF in the binary `data` property. Map an upstream node's JSON onto **Template Data (JSON)** to render one document per item.

`Template Data (JSON)` is logic-less Mustache: `{{var}}` interpolation, `{{#items}}…{{/items}}` loops, and nested `{{a.b}}` access. It only applies to **HTML** and **Markdown** sources.

## Example: extract a page to Markdown for an LLM

1. Add a **Rendex** node, set **Resource** = `Document`, **Operation** = `Extract`
2. Enter the article **URL** (e.g. `https://example.com/blog/post`)
3. Leave **Extract Format** = `Markdown` (or pick `JSON`/`HTML`)
4. Execute — the output JSON has `content` (clean Markdown), plus `title`, `byline`, `excerpt`, `siteName`, and `length`. Map `content` straight into an **AI Agent**, **OpenAI**, or vector-store node — no HTML stripping needed.

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
| Rate limit (req/min) | 3 | 60 | 300 | 1000 |
| Batch size | — | 25 | 100 | 500 |
| Concurrent async jobs | 3 | 50 | 200 | 1000 |
| Geo-targeting | — | — | ✓ | ✓ |

See [rendex.dev/pricing](https://rendex.dev/pricing) for current pricing.

---

## Advanced options

The **Capture** and **Capture Async** operations expose an **Additional Options** collection with the full Rendex parameter surface:

- **Viewport**: Width, Height, Device Scale Factor, Full Page, Dark Mode
- **Device & sizing**: Device preset (iPhone/iPad/Pixel), Resize Width, Resize Height
- **Output**: Quality (for JPEG/WebP)
- **Wait strategy**: Wait Until, Timeout, Delay, Wait For Selector, Best Attempt
- **Element capture**: Element Selector
- **Blocking**: Block Ads, Block Resource Types, Block Cookie Banners, Hide Selectors
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
