import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

// Shared optional fields for the Watch Create + Update collections. The render
// knobs (format/fullPage/device/…/uaMode) are nested under `renderParams` by
// buildWatchBody; the rest (name/threshold/webhookUrl/notifyEmail/paused) are
// top-level on the request. Declared before the class so the description field
// initializer can reference it.
const WATCH_OPTION_FIELDS: INodeProperties[] = [
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		description: 'Optional label for the watch',
	},
	{
		displayName: 'Pause',
		name: 'paused',
		type: 'boolean',
		default: false,
		description: 'Whether to create/leave the watch paused (no checks until resumed)',
	},
	{
		displayName: 'Change Threshold',
		name: 'threshold',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 4 },
		default: 0.01,
		description: 'Visual sensitivity (0–1). Low (default 0.01) alerts on any change, including a small one on a long page (a changed-region test). 0.06+ = only major visual changes (whole-page ratio). Text detection is unaffected.',
	},
	{
		displayName: 'Webhook URL',
		name: 'webhookUrl',
		type: 'string',
		default: '',
		placeholder: 'https://hooks.example.com/rendex',
		description: 'Where to POST a signed change alert (Starter plan and above). Leave empty for email only. On Update, enter "-" or "none" to clear a previously-set URL.',
	},
	{
		displayName: 'Notify Email',
		name: 'notifyEmail',
		type: 'string',
		default: '',
		description: 'Email to alert on a change (any plan). Must be your own account email; defaults to it if empty. On Update, enter "-" or "none" to clear a previously-set address.',
	},
	{
		displayName: 'Capture Format',
		name: 'format',
		type: 'options',
		options: [
			{ name: 'PNG', value: 'png' },
			{ name: 'JPEG', value: 'jpeg' },
			{ name: 'WebP', value: 'webp' },
			{ name: 'PDF', value: 'pdf' },
		],
		default: 'png',
		description: 'A PDF can only be paired with text change-detection (it cannot be visually diffed)',
	},
	{
		displayName: 'Full Page',
		name: 'fullPage',
		type: 'boolean',
		default: true,
		description: 'Whether to monitor the whole scrollable page (default) or just the viewport',
	},
	{
		displayName: 'Device',
		name: 'device',
		type: 'options',
		options: [
			{ name: 'Desktop', value: 'desktop' },
			{ name: 'iPad', value: 'ipad' },
			{ name: 'iPad Pro', value: 'ipad_pro' },
			{ name: 'iPhone 15', value: 'iphone_15' },
			{ name: 'iPhone SE', value: 'iphone_se' },
			{ name: 'Pixel 8', value: 'pixel_8' },
		],
		default: 'desktop',
		description: 'Device preset to emulate',
	},
	{
		displayName: 'Dark Mode',
		name: 'darkMode',
		type: 'boolean',
		default: false,
		description: 'Whether to emulate prefers-color-scheme: dark',
	},
	{
		displayName: 'Block Ads',
		name: 'blockAds',
		type: 'boolean',
		default: true,
		description: 'Whether to block ads and trackers before capture',
	},
	{
		displayName: 'Hide Cookie Banners',
		name: 'blockCookieBanners',
		type: 'boolean',
		default: false,
		description: 'Whether to hide common cookie/consent banners before capture',
	},
	{
		displayName: 'Element Selector',
		name: 'selector',
		type: 'string',
		default: '',
		placeholder: '#price',
		description: 'Capture and diff ONLY this CSS element instead of the whole page',
	},
	{
		displayName: 'Hide Selectors',
		name: 'hideSelectors',
		type: 'string',
		default: '',
		placeholder: '.ad-slot, #live-chat',
		description: 'Comma- or newline-separated CSS selectors to remove before capture',
	},
	{
		displayName: 'Geo Country',
		name: 'geo',
		type: 'string',
		default: '',
		placeholder: 'US',
		description: 'ISO country code to render from (Pro and above). Visual-only — cannot be combined with a text or both diff mode (a geo render returns no extracted text).',
	},
	{
		displayName: 'Ignore Text',
		name: 'ignoreText',
		type: 'string',
		typeOptions: { rows: 2 },
		default: '',
		placeholder: 'Updated at\n/\\d{2}:\\d{2}/',
		description:
			'Newline-separated substrings or /regex/flags stripped from the text before diffing (silence timestamps, view counts). Text detection only.',
	},
	{
		displayName: 'Minimum Text Change (Characters)',
		name: 'minTextChars',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 0,
		description: 'Ignore text changes smaller than this many added + removed characters',
	},
	{
		displayName: 'Suppress While Present',
		name: 'suppressWhilePresent',
		type: 'string',
		typeOptions: { rows: 2 },
		default: '',
		placeholder: 'Out of stock\nLoading',
		description:
			'Newline-separated markers — while the page text contains any of these, the run counts as unchanged (no alert, no baseline drift)',
	},
	{
		displayName: 'Monitor Identity',
		name: 'uaMode',
		type: 'options',
		options: [
			{ name: 'Auto (Identify, Fall Back if Blocked)', value: 'auto' },
			{ name: 'Always Identify as RendexWatch', value: 'identify' },
			{ name: 'Standard Browser (Stealth)', value: 'stealth' },
		],
		default: 'auto',
		description: 'How the monitor presents its User-Agent. See https://rendex.dev/bot.',
	},
];

// The Watch Test dry-run only honors the render knobs (the same ones fed to the
// renderer each check) — a test creates nothing, so the watch-only fields
// (name/paused/threshold/webhookUrl/notifyEmail) are dropped from its inputs.
// Derived from WATCH_OPTION_FIELDS so the field definitions stay single-sourced.
const WATCH_TEST_RENDER_FIELD_NAMES = new Set<string>([
	'format',
	'fullPage',
	'device',
	'darkMode',
	'blockAds',
	'blockCookieBanners',
	'selector',
	'hideSelectors',
	'geo',
	'ignoreText',
	'minTextChars',
	'suppressWhilePresent',
	'uaMode',
]);
const WATCH_TEST_OPTION_FIELDS: INodeProperties[] = WATCH_OPTION_FIELDS.filter((f) =>
	WATCH_TEST_RENDER_FIELD_NAMES.has(f.name),
);

export class Rendex implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Rendex',
		name: 'rendex',
		icon: 'file:rendex.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Capture screenshots, generate PDFs, render HTML, and extract content via Rendex',
		defaults: {
			name: 'Rendex',
		},
		inputs: ['main'],
		outputs: ['main'],
		usableAsTool: true,
		credentials: [
			{
				name: 'rendexApi',
				required: true,
			},
		],
		properties: [
			// ─── Resource ──────────────────────────────────────────────
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Artifact', value: 'artifact' },
					{ name: 'Batch', value: 'batch' },
					{ name: 'Document', value: 'document' },
					{ name: 'Job', value: 'job' },
					{ name: 'Screenshot', value: 'screenshot' },
					{ name: 'Watch', value: 'watch' },
				],
				default: 'screenshot',
			},

			// ─── Account Operations ────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['account'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						description:
							"Get the caller's plan, this month's usage, per-minute rate limit, and upgrade info (read-only, no credits)",
						action: 'Get account plan and usage',
					},
				],
				default: 'get',
			},

			// ─── Artifact Operations ───────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['artifact'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						description:
							'Render a branded PDF/PNG artifact (plus a hosted share page) from Markdown or HTML in one call',
						action: 'Create a branded artifact',
					},
				],
				default: 'create',
			},

			// ─── Watch Operations ──────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['watch'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Start monitoring a URL for changes on a schedule',
						action: 'Create a watch',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a watch and its run history',
						action: 'Delete a watch',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Fetch one watch by ID',
						action: 'Get a watch',
					},
					{
						name: 'Get Many',
						value: 'list',
						description: 'List your watches',
						action: 'Get many watches',
					},
					{
						name: 'Run Now',
						value: 'run',
						description: 'Run an immediate check now (charges 1 credit)',
						action: 'Run a watch now',
					},
					{
						name: 'Test',
						value: 'test',
						description: 'Dry-run a config to preview what a watch would capture, without creating one',
						action: 'Test a watch config',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update, pause, resume, or re-point a watch',
						action: 'Update a watch',
					},
				],
				default: 'create',
			},

			// ─── Screenshot Operations ─────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['screenshot'] } },
				options: [
					{
						name: 'Capture',
						value: 'capture',
						description: 'Capture a screenshot or PDF synchronously and return the result',
						action: 'Capture a screenshot or PDF',
					},
					{
						name: 'Capture Async',
						value: 'captureAsync',
						description: 'Submit a capture job and return immediately with a job ID',
						action: 'Submit an async capture job',
					},
					{
						name: 'Render Link',
						value: 'renderLink',
						description: 'Render HTML/URL to a signed, hosted image/PDF URL (for og:image)',
						action: 'Render a hosted image or PDF link',
					},
				],
				default: 'capture',
			},

			// ─── Document Operations ───────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['document'] } },
				options: [
					{
						name: 'Extract',
						value: 'extract',
						description:
							'Extract clean reader-mode content (Markdown/JSON/HTML) from a URL — ideal for LLM and RAG pipelines',
						action: 'Extract content from a URL',
					},
				],
				default: 'extract',
			},

			// ─── Job Operations ────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['job'] } },
				options: [
					{
						name: 'Get Status',
						value: 'getStatus',
						description: 'Poll the status of an async job',
						action: 'Get job status',
					},
				],
				default: 'getStatus',
			},

			// ─── Batch Operations ──────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['batch'] } },
				options: [
					{
						name: 'Submit',
						value: 'submit',
						description: 'Submit a batch of URLs for capture (up to 500 per plan limit)',
						action: 'Submit a batch',
					},
					{
						name: 'Get Status',
						value: 'getStatus',
						description: 'Poll the status of a batch and its jobs',
						action: 'Get batch status',
					},
				],
				default: 'submit',
			},

			// ─── Screenshot: Source ────────────────────────────────────
			{
				displayName: 'Source',
				name: 'source',
				type: 'options',
				displayOptions: { show: { resource: ['screenshot'] } },
				options: [
					{ name: 'URL', value: 'url' },
					{ name: 'HTML', value: 'html' },
					{ name: 'Markdown', value: 'markdown' },
				],
				default: 'url',
				description: 'Whether to capture a live URL, render raw HTML, or render Markdown',
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://example.com',
				displayOptions: {
					show: {
						resource: ['screenshot'],
						source: ['url'],
					},
				},
				description: 'The URL to capture',
			},
			{
				displayName: 'HTML',
				name: 'html',
				type: 'string',
				typeOptions: {
					rows: 6,
				},
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['screenshot'],
						source: ['html'],
					},
				},
				description: 'Raw HTML to render (max 5 MB)',
			},
			{
				displayName: 'Markdown',
				name: 'markdown',
				type: 'string',
				typeOptions: {
					rows: 6,
				},
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['screenshot'],
						source: ['markdown'],
					},
				},
				description: 'Markdown to render — converted to HTML server-side (max 5 MB)',
			},
			{
				displayName: 'Template Data (JSON)',
				name: 'templateData',
				type: 'json',
				default: '{}',
				displayOptions: {
					show: {
						resource: ['screenshot'],
						source: ['html', 'markdown'],
					},
				},
				description:
					'Optional. JSON object of values to fill {{placeholders}} in your HTML/Markdown before rendering.',
			},

			// ─── Screenshot: Format ────────────────────────────────────
			{
				displayName: 'Format',
				name: 'format',
				type: 'options',
				displayOptions: { show: { resource: ['screenshot'] } },
				options: [
					{ name: 'PNG', value: 'png' },
					{ name: 'JPEG', value: 'jpeg' },
					{ name: 'WebP', value: 'webp' },
					{ name: 'PDF', value: 'pdf' },
				],
				default: 'png',
				description: 'Output format. PDF ignores image-specific options and uses PDF options instead.',
			},

			// ─── Screenshot: Binary Property Name ──────────────────────
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['screenshot'],
						operation: ['capture'],
					},
				},
				default: 'data',
				description: 'Name of the output binary property the image or PDF will be written to',
			},

			// ─── Screenshot: Async-Only Options ────────────────────────
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['screenshot'],
						operation: ['captureAsync'],
					},
				},
				default: '',
				placeholder: 'https://example.com/rendex-callback',
				description: 'Optional URL to receive an HMAC-signed webhook when the capture completes',
			},

			// ─── Render Link: Link Expiry ──────────────────────────────
			{
				displayName: 'Link Expiry (Seconds)',
				name: 'expiresIn',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 2592000 },
				displayOptions: {
					show: {
						resource: ['screenshot'],
						operation: ['renderLink'],
					},
				},
				default: 0,
				description:
					'How long the signed link stays valid, in seconds (3600–2592000). Leave 0 to use the default (30 days).',
			},

			// ─── Screenshot: Additional Options ────────────────────────
			{
				displayName: 'Additional Options',
				name: 'additionalOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['screenshot'],
						operation: ['capture', 'captureAsync', 'renderLink'],
					},
				},
				options: [
					{
						displayName: 'Best Attempt',
						name: 'bestAttempt',
						type: 'boolean',
						default: true,
						description: 'Whether to return a partial capture on timeout instead of erroring',
					},
					{
						displayName: 'Block Ads',
						name: 'blockAds',
						type: 'boolean',
						default: true,
						description: 'Whether to block ads, trackers, and chat widgets during capture',
					},
					{
						displayName: 'Block Cookie Banners',
						name: 'blockCookieBanners',
						type: 'boolean',
						default: false,
						description: 'Whether to hide common cookie/consent banners before capture',
					},
					{
						displayName: 'Block Resource Types',
						name: 'blockResourceTypes',
						type: 'multiOptions',
						options: [
							{ name: 'Font', value: 'font' },
							{ name: 'Image', value: 'image' },
							{ name: 'Media', value: 'media' },
							{ name: 'Other', value: 'other' },
							{ name: 'Stylesheet', value: 'stylesheet' },
						],
						default: [],
						description: 'Additional resource types to block during capture',
					},
					{
						displayName: 'Cache TTL (Seconds)',
						name: 'cacheTtl',
						type: 'number',
						typeOptions: { minValue: 3600, maxValue: 2592000 },
						default: 86400,
						description:
							'For async captures, how long the signed result URL stays valid (3600–2592000 seconds)',
					},
					{
						displayName: 'Cookies (JSON Array)',
						name: 'cookies',
						type: 'json',
						default: '[]',
						description:
							'Cookies to set before navigation, as a JSON array of { name, value, domain?, path?, httpOnly?, secure?, sameSite?, expires? } objects (max 50)',
					},
					{
						displayName: 'Custom CSS',
						name: 'css',
						type: 'string',
						typeOptions: { rows: 3 },
						default: '',
						description: 'CSS to inject into the page before capture (max 50 KB)',
					},
					{
						displayName: 'Custom Headers (JSON)',
						name: 'headers',
						type: 'json',
						default: '{}',
						description:
							'HTTP headers to send with the navigation request, as a JSON object. Cannot override Host, Connection, Content-Length, or Transfer-Encoding.',
					},
					{
						displayName: 'Custom JavaScript',
						name: 'js',
						type: 'string',
						typeOptions: { rows: 3 },
						default: '',
						description: 'JavaScript to execute in the page before capture (max 50 KB)',
					},
					{
						displayName: 'Dark Mode',
						name: 'darkMode',
						type: 'boolean',
						default: false,
						description: 'Whether to emulate prefers-color-scheme: dark',
					},
					{
						displayName: 'Delay (Ms)',
						name: 'delay',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 10000 },
						default: 0,
						description: 'Extra delay after load before capture, in milliseconds (0–10000)',
					},
					{
						displayName: 'Device',
						name: 'device',
						type: 'options',
						options: [
							{ name: 'Desktop', value: 'desktop' },
							{ name: 'iPad', value: 'ipad' },
							{ name: 'iPad Pro', value: 'ipad_pro' },
							{ name: 'iPhone 15', value: 'iphone_15' },
							{ name: 'iPhone SE', value: 'iphone_se' },
							{ name: 'Pixel 8', value: 'pixel_8' },
						],
						default: 'desktop',
						description: 'Device preset (sets viewport, scale, and user agent)',
					},
					{
						displayName: 'Device Scale Factor',
						name: 'deviceScaleFactor',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 3, numberPrecision: 1 },
						default: 2,
						description: 'Device pixel ratio (1–3). Higher = sharper but larger files.',
					},
					{
						displayName: 'Element Selector',
						name: 'selector',
						type: 'string',
						default: '',
						placeholder: '#hero, .card',
						description: 'CSS selector to capture a specific element instead of the full page',
					},
					{
						displayName: 'Full Page',
						name: 'fullPage',
						type: 'boolean',
						default: false,
						description: 'Whether to capture the entire scrollable page with auto-scroll',
					},
					{
						displayName: 'Geo City',
						name: 'geoCity',
						type: 'string',
						default: '',
						description: 'City for more precise geo-targeting. Requires Geo Country to be set.',
					},
					{
						displayName: 'Geo Country',
						name: 'geo',
						type: 'string',
						default: '',
						placeholder: 'US',
						description:
							'ISO 3166-1 alpha-2 country code for geo-targeted capture (e.g. US, DE, JP). Pro or Enterprise plan required.',
					},
					{
						displayName: 'Geo State',
						name: 'geoState',
						type: 'string',
						default: '',
						description:
							'State or region for more precise geo-targeting. Requires Geo Country to be set.',
					},
					{
						displayName: 'Height',
						name: 'height',
						type: 'number',
						typeOptions: { minValue: 240, maxValue: 2160 },
						default: 800,
						description: 'Viewport height in pixels (240–2160)',
					},
					{
						displayName: 'Hide Selectors',
						name: 'hideSelectors',
						type: 'string',
						default: '',
						placeholder: '.cookie-banner, #ad-slot',
						description: 'Comma- or newline-separated CSS selectors to hide before capture',
					},
					{
						displayName: 'PDF Landscape',
						name: 'pdfLandscape',
						type: 'boolean',
						default: false,
						description: 'Whether the PDF is oriented landscape (only applies when Format = PDF)',
					},
					{
						displayName: 'PDF Margins (JSON)',
						name: 'pdfMargin',
						type: 'json',
						default: '{"top":"0","right":"0","bottom":"0","left":"0"}',
						description:
							'PDF margins as a JSON object with CSS unit strings, e.g. { "top": "1cm", "right": "20px", "bottom": "1cm", "left": "20px" }',
					},
					{
						displayName: 'PDF Page Format',
						name: 'pdfFormat',
						type: 'options',
						options: [
							{ name: 'A3', value: 'A3' },
							{ name: 'A4', value: 'A4' },
							{ name: 'Legal', value: 'Legal' },
							{ name: 'Letter', value: 'Letter' },
							{ name: 'Tabloid', value: 'Tabloid' },
						],
						default: 'A4',
						description: 'PDF page size (only applies when Format = PDF)',
					},
					{
						displayName: 'PDF Print Background',
						name: 'pdfPrintBackground',
						type: 'boolean',
						default: true,
						description: 'Whether to print background colors and images in the PDF',
					},
					{
						displayName: 'PDF Scale',
						name: 'pdfScale',
						type: 'number',
						typeOptions: { minValue: 0.1, maxValue: 2, numberPrecision: 2 },
						default: 1,
						description: 'PDF scale factor (0.1–2)',
					},
					{
						displayName: 'Quality',
						name: 'quality',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 100 },
						default: 80,
						description: 'JPEG/WebP compression quality (1–100). Ignored for PNG and PDF.',
					},
					{
						displayName: 'Resize Height',
						name: 'resizeHeight',
						type: 'number',
						typeOptions: { minValue: 16, maxValue: 2160 },
						default: 0,
						description: 'Resize output height in px',
					},
					{
						displayName: 'Resize Width',
						name: 'resizeWidth',
						type: 'number',
						typeOptions: { minValue: 16, maxValue: 3840 },
						default: 0,
						description: 'Resize output width in px (keeps aspect ratio if height omitted)',
					},
					{
						displayName: 'Timeout (Seconds)',
						name: 'timeout',
						type: 'number',
						typeOptions: { minValue: 5, maxValue: 60 },
						default: 30,
						description: 'Page load timeout in seconds (5–60)',
					},
					{
						displayName: 'User Agent',
						name: 'userAgent',
						type: 'string',
						default: '',
						description: 'Override the browser user-agent string',
					},
					{
						displayName: 'Wait For Selector',
						name: 'waitForSelector',
						type: 'string',
						default: '',
						description: 'Wait for a CSS selector to appear before capture',
					},
					{
						displayName: 'Wait Until',
						name: 'waitUntil',
						type: 'options',
						options: [
							{ name: 'DOM Content Loaded', value: 'domcontentloaded' },
							{ name: 'Load', value: 'load' },
							{ name: 'Network Idle 0', value: 'networkidle0' },
							{ name: 'Network Idle 2', value: 'networkidle2' },
						],
						default: 'networkidle2',
						description: 'Navigation wait condition before capture',
					},
					{
						displayName: 'Width',
						name: 'width',
						type: 'number',
						typeOptions: { minValue: 320, maxValue: 3840 },
						default: 1280,
						description: 'Viewport width in pixels (320–3840)',
					},
				],
			},

			// ─── Job: Get Status ───────────────────────────────────────
			{
				displayName: 'Job ID',
				name: 'jobId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['job'],
						operation: ['getStatus'],
					},
				},
				description: 'ID of the async job returned by Capture Async',
			},

			// ─── Batch: Submit ─────────────────────────────────────────
			{
				displayName: 'URLs',
				name: 'urls',
				type: 'string',
				typeOptions: { rows: 5 },
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['batch'],
						operation: ['submit'],
					},
				},
				placeholder: 'https://example.com\nhttps://another.com',
				description: 'Newline-separated list of URLs to capture (up to 500 per plan limit)',
			},
			{
				displayName: 'Defaults (JSON)',
				name: 'defaults',
				type: 'json',
				default: '{"format":"png","fullPage":true}',
				displayOptions: {
					show: {
						resource: ['batch'],
						operation: ['submit'],
					},
				},
				description:
					'Default capture options applied to every URL in the batch. JSON object using the same shape as Additional Options on Capture.',
			},
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['batch'],
						operation: ['submit'],
					},
				},
				description: 'Optional URL called with an HMAC-signed payload when the whole batch completes',
			},
			{
				displayName: 'Cache TTL (Seconds)',
				name: 'cacheTtl',
				type: 'number',
				typeOptions: { minValue: 3600, maxValue: 2592000 },
				default: 86400,
				displayOptions: {
					show: {
						resource: ['batch'],
						operation: ['submit'],
					},
				},
				description: 'How long signed result URLs stay valid (3600–2592000 seconds)',
			},

			// ─── Batch: Get Status ─────────────────────────────────────
			{
				displayName: 'Batch ID',
				name: 'batchId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['batch'],
						operation: ['getStatus'],
					},
				},
				description: 'ID of the batch returned by Submit',
			},

			// ─── Document: Extract ─────────────────────────────────────
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://example.com/article',
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['extract'],
					},
				},
				description: 'The URL to extract clean reader-mode content from',
			},
			{
				displayName: 'Extract Format',
				name: 'extractFormat',
				type: 'options',
				options: [
					{ name: 'Markdown', value: 'markdown' },
					{ name: 'JSON', value: 'json' },
					{ name: 'HTML', value: 'html' },
				],
				default: 'markdown',
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['extract'],
					},
				},
				description: 'Output format of the extracted content',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['extract'],
					},
				},
				options: [
					{
						displayName: 'Block Ads',
						name: 'blockAds',
						type: 'boolean',
						default: true,
						description: 'Whether to block ads, trackers, and chat widgets before extraction',
					},
					{
						displayName: 'Block Cookie Banners',
						name: 'blockCookieBanners',
						type: 'boolean',
						default: false,
						description: 'Whether to hide common cookie/consent banners before extraction',
					},
					{
						displayName: 'Device',
						name: 'device',
						type: 'options',
						options: [
							{ name: 'Desktop', value: 'desktop' },
							{ name: 'iPad', value: 'ipad' },
							{ name: 'iPad Pro', value: 'ipad_pro' },
							{ name: 'iPhone 15', value: 'iphone_15' },
							{ name: 'iPhone SE', value: 'iphone_se' },
							{ name: 'Pixel 8', value: 'pixel_8' },
						],
						default: 'desktop',
						description: 'Device preset (sets viewport, scale, and user agent)',
					},
					{
						displayName: 'Hide Selectors',
						name: 'hideSelectors',
						type: 'string',
						default: '',
						placeholder: '.cookie-banner, #ad-slot',
						description: 'Comma- or newline-separated CSS selectors to hide before extraction',
					},
					{
						displayName: 'Timeout (Seconds)',
						name: 'timeout',
						type: 'number',
						typeOptions: { minValue: 5, maxValue: 60 },
						default: 30,
						description: 'Page load timeout in seconds (5–60)',
					},
					{
						displayName: 'Wait Until',
						name: 'waitUntil',
						type: 'options',
						options: [
							{ name: 'DOM Content Loaded', value: 'domcontentloaded' },
							{ name: 'Load', value: 'load' },
							{ name: 'Network Idle 0', value: 'networkidle0' },
							{ name: 'Network Idle 2', value: 'networkidle2' },
						],
						default: 'networkidle2',
						description: 'Navigation wait condition before extraction',
					},
				],
			},

			// ─── Artifact: Create ──────────────────────────────────────
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 6 },
				required: true,
				default: '',
				displayOptions: { show: { resource: ['artifact'], operation: ['create'] } },
				description: 'The Markdown or HTML body to turn into a branded artifact (up to ~4 MB)',
			},
			{
				displayName: 'Input Format',
				name: 'inputFormat',
				type: 'options',
				options: [
					{ name: 'Markdown', value: 'markdown' },
					{ name: 'HTML', value: 'html' },
				],
				default: 'markdown',
				displayOptions: { show: { resource: ['artifact'], operation: ['create'] } },
				description: 'Whether Content is Markdown (converted to styled HTML) or a raw HTML body fragment',
			},
			{
				displayName: 'Output Formats',
				name: 'formats',
				type: 'multiOptions',
				options: [
					{ name: 'PDF', value: 'pdf' },
					{ name: 'PNG', value: 'png' },
				],
				default: ['pdf', 'png'],
				displayOptions: { show: { resource: ['artifact'], operation: ['create'] } },
				description: 'Which hosted outputs to produce. Each requested format charges 1 credit.',
			},
			{
				displayName: 'Additional Options',
				name: 'artifactOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['artifact'], operation: ['create'] } },
				options: [
					{
						displayName: 'Accent Color',
						name: 'accentColor',
						type: 'color',
						default: '',
						placeholder: '#EA580C',
						description: 'CSS color for the accent bar, links, and headings (e.g. #EA580C)',
					},
					{
						displayName: 'Font',
						name: 'font',
						type: 'string',
						default: '',
						placeholder: 'Georgia, serif',
						description: 'CSS font-family stack applied to the artifact body',
					},
					{
						displayName: 'Footer',
						name: 'footer',
						type: 'string',
						default: '',
						description: 'Plain-text footer line shown at the bottom of every page',
					},
					{
						displayName: 'Header',
						name: 'header',
						type: 'string',
						default: '',
						description:
							'Plain-text header/brand line shown beside the logo and used as the share-page title',
					},
					{
						displayName: 'Link Expiry (Seconds)',
						name: 'expiresIn',
						type: 'number',
						typeOptions: { minValue: 3600, maxValue: 2592000 },
						default: 86400,
						description:
							'How long the hosted artifact URLs stay valid, in seconds (3600–2592000). Defaults to 86400 (24h).',
					},
					{
						displayName: 'Logo URL',
						name: 'logo',
						type: 'string',
						default: '',
						placeholder: 'https://example.com/logo.png',
						description: 'Absolute http(s) URL of a logo image shown in the branded header',
					},
					{
						displayName: 'Template Data (JSON)',
						name: 'data',
						type: 'json',
						default: '{}',
						description:
							'Optional. JSON object of values to fill {{placeholders}} in Content (Mustache) before rendering.',
					},
				],
			},

			// ─── Watch: ID (get / update / delete / run) ───────────────
			{
				displayName: 'Watch ID',
				name: 'watchId',
				type: 'string',
				required: true,
				default: '',
				placeholder: '11111111-2222-3333-4444-555555555555',
				displayOptions: { show: { resource: ['watch'], operation: ['get', 'update', 'delete', 'run'] } },
				description: 'The ID of the watch (from a Create or Get Many result)',
			},

			// ─── Watch: Create / Test (shared URL + Change Detection) ──
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://example.com/pricing',
				displayOptions: { show: { resource: ['watch'], operation: ['create', 'test'] } },
				description: 'The page to monitor for changes',
			},
			{
				displayName: 'Check Every (Minutes)',
				name: 'intervalMinutes',
				type: 'number',
				typeOptions: { minValue: 5, maxValue: 43200 },
				default: 1440,
				displayOptions: { show: { resource: ['watch'], operation: ['create'] } },
				description:
					"How often to check, in minutes. The minimum is your plan's floor — Free 1440 (daily), Starter 180, Pro 30, Enterprise 5. A faster value is rejected with WATCH_INTERVAL_TOO_FAST.",
			},
			{
				displayName: 'Change Detection',
				name: 'diffMode',
				type: 'options',
				options: [
					{ name: 'Visual (Pixel Diff + Overlay)', value: 'visual' },
					{ name: 'Text (Extracted-Text Diff)', value: 'text' },
					{ name: 'Both', value: 'both' },
				],
				default: 'both',
				displayOptions: { show: { resource: ['watch'], operation: ['create', 'test'] } },
				description: 'How changes are detected. Default Both = a pixel diff (with overlay) AND a full-page text diff, alerting on either — catches any change. Visual cannot monitor a PDF; text cannot be combined with geo.',
			},
			{
				displayName: 'Additional Options',
				name: 'watchOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['watch'], operation: ['create'] } },
				options: WATCH_OPTION_FIELDS,
			},

			// ─── Watch: Test (render knobs only — no schedule/alert/threshold) ──
			{
				displayName: 'Additional Options',
				name: 'watchTestOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['watch'], operation: ['test'] } },
				options: WATCH_TEST_OPTION_FIELDS,
			},

			// ─── Watch: Get Many ───────────────────────────────────────
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'All', value: 'all' },
					{ name: 'Active', value: 'active' },
					{ name: 'Paused', value: 'paused' },
				],
				default: 'all',
				displayOptions: { show: { resource: ['watch'], operation: ['list'] } },
				description: 'Filter watches by status',
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['watch'], operation: ['list'] } },
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				displayOptions: { show: { resource: ['watch'], operation: ['list'], returnAll: [false] } },
				description: 'Max number of results to return',
			},

			// ─── Watch: Update ─────────────────────────────────────────
			{
				displayName: 'Update Fields',
				name: 'updateFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['watch'], operation: ['update'] } },
				options: [
					{
						displayName: 'New URL',
						name: 'url',
						type: 'string',
						default: '',
						description: 'Re-point the watch at a new URL (clears the baseline; the next check re-baselines)',
					},
					{
						displayName: 'Check Every (Minutes)',
						name: 'intervalMinutes',
						type: 'number',
						typeOptions: { minValue: 5, maxValue: 43200 },
						default: 1440,
						description: "How often to check, in minutes (your plan's floor is the minimum)",
					},
					{
						displayName: 'Change Detection',
						name: 'diffMode',
						type: 'options',
						options: [
							{ name: 'Visual (Pixel Diff + Overlay)', value: 'visual' },
							{ name: 'Text (Extracted-Text Diff)', value: 'text' },
							{ name: 'Both', value: 'both' },
						],
						default: 'visual',
						description: 'How changes are detected',
					},
					...WATCH_OPTION_FIELDS,
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('rendexApi');
		const baseUrl = ((credentials.baseUrl as string) || 'https://api.rendex.dev').replace(/\/+$/, '');

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'screenshot' && operation === 'capture') {
					const body = buildCaptureBody.call(this, i);
					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rendexApi',
						{
							method: 'POST',
							url: `${baseUrl}/v1/screenshot/json`,
							body,
							json: true,
						} as IHttpRequestOptions,
					)) as {
						success: boolean;
						data: {
							image: string;
							contentType: string;
							url: string;
							format: string;
							bytesSize: number;
							[key: string]: unknown;
						};
						meta: IDataObject;
					};

					if (!response?.data?.image) {
						throw new NodeOperationError(
							this.getNode(),
							'Rendex returned no image data — check that the URL or HTML is valid.',
							{ itemIndex: i },
						);
					}

					const binaryPropertyName = this.getNodeParameter(
						'binaryPropertyName',
						i,
						'data',
					) as string;
					const imageBuffer = Buffer.from(response.data.image, 'base64');
					const extension = response.data.format === 'pdf' ? 'pdf' : response.data.format;
					const filename = `rendex-${Date.now()}.${extension}`;

					const binaryData = await this.helpers.prepareBinaryData(
						imageBuffer,
						filename,
						response.data.contentType,
					);

					const { image: _image, ...metadata } = response.data;
					returnData.push({
						json: { ...metadata, meta: response.meta } as IDataObject,
						binary: { [binaryPropertyName]: binaryData },
						pairedItem: { item: i },
					});
				} else if (resource === 'screenshot' && operation === 'captureAsync') {
					const body = buildCaptureBody.call(this, i);
					body.async = true;
					const webhookUrl = this.getNodeParameter('webhookUrl', i, '') as string;
					if (webhookUrl) body.webhookUrl = webhookUrl;

					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rendexApi',
						{
							method: 'POST',
							url: `${baseUrl}/v1/screenshot`,
							body,
							json: true,
						} as IHttpRequestOptions,
					)) as IDataObject;

					returnData.push({
						json: response,
						pairedItem: { item: i },
					});
				} else if (resource === 'screenshot' && operation === 'renderLink') {
					const body = buildCaptureBody.call(this, i);
					const expiresIn = this.getNodeParameter('expiresIn', i, 0) as number;
					if (expiresIn) body.expiresIn = expiresIn;

					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rendexApi',
						{
							method: 'POST',
							url: `${baseUrl}/v1/render/link`,
							body,
							json: true,
						} as IHttpRequestOptions,
					)) as { data?: IDataObject };

					returnData.push({
						json: (response.data ?? response) as IDataObject,
						pairedItem: { item: i },
					});
				} else if (resource === 'document' && operation === 'extract') {
					const body = buildExtractBody.call(this, i);
					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rendexApi',
						{
							method: 'POST',
							url: `${baseUrl}/v1/extract`,
							body,
							json: true,
						} as IHttpRequestOptions,
					)) as IDataObject;

					returnData.push({ json: response, pairedItem: { item: i } });
				} else if (resource === 'job' && operation === 'getStatus') {
					const jobId = this.getNodeParameter('jobId', i) as string;
					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rendexApi',
						{
							method: 'GET',
							url: `${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}`,
							json: true,
						} as IHttpRequestOptions,
					)) as IDataObject;

					returnData.push({ json: response, pairedItem: { item: i } });
				} else if (resource === 'batch' && operation === 'submit') {
					const urlsRaw = this.getNodeParameter('urls', i) as string;
					const urls = urlsRaw
						.split('\n')
						.map((u) => u.trim())
						.filter(Boolean);

					if (urls.length === 0) {
						throw new NodeOperationError(
							this.getNode(),
							'Provide at least one URL for the batch.',
							{ itemIndex: i },
						);
					}

					const defaultsRaw = this.getNodeParameter('defaults', i, '{}') as string | IDataObject;
					const defaults: IDataObject =
						typeof defaultsRaw === 'string'
							? safeJsonParse.call<IExecuteFunctions, [string, IDataObject, string, number], IDataObject>(
									this,
									defaultsRaw,
									{},
									'Defaults',
									i,
								)
							: defaultsRaw;

					const body: IDataObject = { urls, defaults };
					const webhookUrl = this.getNodeParameter('webhookUrl', i, '') as string;
					if (webhookUrl) body.webhookUrl = webhookUrl;
					const cacheTtl = this.getNodeParameter('cacheTtl', i, 86400) as number;
					if (cacheTtl) body.cacheTtl = cacheTtl;

					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rendexApi',
						{
							method: 'POST',
							url: `${baseUrl}/v1/screenshot/batch`,
							body,
							json: true,
						} as IHttpRequestOptions,
					)) as IDataObject;

					returnData.push({ json: response, pairedItem: { item: i } });
				} else if (resource === 'batch' && operation === 'getStatus') {
					const batchId = this.getNodeParameter('batchId', i) as string;
					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rendexApi',
						{
							method: 'GET',
							url: `${baseUrl}/v1/batches/${encodeURIComponent(batchId)}`,
							json: true,
						} as IHttpRequestOptions,
					)) as IDataObject;

					returnData.push({ json: response, pairedItem: { item: i } });
				} else if (resource === 'artifact' && operation === 'create') {
					const body = buildArtifactBody.call(this, i);
					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rendexApi',
						{ method: 'POST', url: `${baseUrl}/v1/artifact`, body, json: true } as IHttpRequestOptions,
					)) as { data?: IDataObject };
					returnData.push({ json: (response.data ?? response) as IDataObject, pairedItem: { item: i } });
				} else if (resource === 'account' && operation === 'get') {
					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rendexApi',
						{ method: 'GET', url: `${baseUrl}/v1/account`, json: true } as IHttpRequestOptions,
					)) as { data?: IDataObject };
					returnData.push({ json: (response.data ?? response) as IDataObject, pairedItem: { item: i } });
				} else if (resource === 'watch' && operation === 'create') {
					const watchOptions = this.getNodeParameter('watchOptions', i, {}) as IDataObject;
					const body = buildWatchBody({
						url: this.getNodeParameter('url', i) as string,
						intervalMinutes: this.getNodeParameter('intervalMinutes', i, 1440) as number,
						diffMode: this.getNodeParameter('diffMode', i, 'visual') as string,
						...watchOptions,
					});
					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rendexApi',
						{ method: 'POST', url: `${baseUrl}/v1/watches`, body, json: true } as IHttpRequestOptions,
					)) as { data?: IDataObject };
					returnData.push({ json: (response.data ?? response) as IDataObject, pairedItem: { item: i } });
				} else if (resource === 'watch' && operation === 'test') {
					// Dry-run: preview what a watch would capture without creating one.
					// Only url + diffMode + render knobs are sent; buildWatchBody nests the
					// render knobs under `renderParams`.
					const watchTestOptions = this.getNodeParameter('watchTestOptions', i, {}) as IDataObject;
					const body = buildWatchBody({
						url: this.getNodeParameter('url', i) as string,
						diffMode: this.getNodeParameter('diffMode', i, 'visual') as string,
						...watchTestOptions,
					});
					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rendexApi',
						{ method: 'POST', url: `${baseUrl}/v1/watches/test`, body, json: true } as IHttpRequestOptions,
					)) as { data?: IDataObject };
					returnData.push({ json: (response.data ?? response) as IDataObject, pairedItem: { item: i } });
				} else if (resource === 'watch' && operation === 'get') {
					const watchId = this.getNodeParameter('watchId', i) as string;
					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rendexApi',
						{ method: 'GET', url: `${baseUrl}/v1/watches/${encodeURIComponent(watchId)}`, json: true } as IHttpRequestOptions,
					)) as { data?: IDataObject };
					returnData.push({ json: (response.data ?? response) as IDataObject, pairedItem: { item: i } });
				} else if (resource === 'watch' && operation === 'list') {
					const status = this.getNodeParameter('status', i, 'all') as string;
					const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
					// The API caps page size at 100. returnAll follows nextCursor to the end
					// (an account can hold up to 1000 watches); otherwise return one clamped page.
					const watchItems: IDataObject[] = [];
					if (returnAll) {
						let cursor: string | undefined;
						for (let page = 0; page < 40; page++) {
							const qs: IDataObject = { status, limit: 100 };
							if (cursor) qs.cursor = cursor;
							const res = (await this.helpers.httpRequestWithAuthentication.call(
								this,
								'rendexApi',
								{ method: 'GET', url: `${baseUrl}/v1/watches`, qs, json: true } as IHttpRequestOptions,
							)) as { data?: { items?: IDataObject[]; nextCursor?: string | null } };
							watchItems.push(...(res.data?.items ?? []));
							cursor = res.data?.nextCursor ?? undefined;
							if (!cursor) break;
						}
					} else {
						const limit = Math.min(this.getNodeParameter('limit', i, 50) as number, 100);
						const res = (await this.helpers.httpRequestWithAuthentication.call(
							this,
							'rendexApi',
							{ method: 'GET', url: `${baseUrl}/v1/watches`, qs: { status, limit }, json: true } as IHttpRequestOptions,
						)) as { data?: { items?: IDataObject[] } };
						watchItems.push(...(res.data?.items ?? []));
					}
					if (watchItems.length === 0) {
						returnData.push({ json: { items: [] }, pairedItem: { item: i } });
					}
					for (const w of watchItems) {
						returnData.push({ json: w, pairedItem: { item: i } });
					}
				} else if (resource === 'watch' && operation === 'run') {
					const watchId = this.getNodeParameter('watchId', i) as string;
					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rendexApi',
						{ method: 'POST', url: `${baseUrl}/v1/watches/${encodeURIComponent(watchId)}/run`, body: {}, json: true } as IHttpRequestOptions,
					)) as { data?: IDataObject };
					returnData.push({ json: (response.data ?? response) as IDataObject, pairedItem: { item: i } });
				} else if (resource === 'watch' && operation === 'update') {
					const watchId = this.getNodeParameter('watchId', i) as string;
					const updateFields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
					const body = buildWatchBody(updateFields, true);
					if (Object.keys(body).length === 0) {
						throw new NodeOperationError(
							this.getNode(),
							'Provide at least one field to update.',
							{ itemIndex: i },
						);
					}
					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rendexApi',
						{ method: 'PATCH', url: `${baseUrl}/v1/watches/${encodeURIComponent(watchId)}`, body, json: true } as IHttpRequestOptions,
					)) as { data?: IDataObject };
					returnData.push({ json: (response.data ?? response) as IDataObject, pairedItem: { item: i } });
				} else if (resource === 'watch' && operation === 'delete') {
					const watchId = this.getNodeParameter('watchId', i) as string;
					await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rendexApi',
						{ method: 'DELETE', url: `${baseUrl}/v1/watches/${encodeURIComponent(watchId)}`, json: true } as IHttpRequestOptions,
					);
					returnData.push({ json: { deleted: true, id: watchId }, pairedItem: { item: i } });
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`Unknown operation "${resource}.${operation}"`,
						{ itemIndex: i },
					);
				}
			} catch (error) {
				// On a 429, surface Rendex's own upgrade nudge (rate-limit or monthly cap)
				// — message + upgrade link straight from the API body — instead of a bare
				// "429", so an n8n user hitting the free 10 req/min cap sees the reason and
				// the upgrade path.
				const nudge = extractUpgradeNudge(error);
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: nudge?.message ?? (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeOperationError || error instanceof NodeApiError) {
					throw error;
				}
				if (nudge) {
					throw new NodeApiError(this.getNode(), error as JsonObject, {
						itemIndex: i,
						message: nudge.message,
						description: nudge.description,
					});
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

// ─── Helpers ────────────────────────────────────────────────────────

const ADDITIONAL_OPTION_KEYS = [
	'width',
	'height',
	'fullPage',
	'deviceScaleFactor',
	'device',
	'darkMode',
	'quality',
	'selector',
	'waitUntil',
	'timeout',
	'delay',
	'waitForSelector',
	'bestAttempt',
	'blockAds',
	'blockCookieBanners',
	'blockResourceTypes',
	'resizeWidth',
	'resizeHeight',
	'css',
	'js',
	'userAgent',
	'pdfFormat',
	'pdfLandscape',
	'pdfPrintBackground',
	'pdfScale',
	'geo',
	'geoCity',
	'geoState',
	'cacheTtl',
] as const;

const JSON_OPTION_KEYS = ['headers', 'cookies', 'pdfMargin'] as const;

function buildCaptureBody(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const source = this.getNodeParameter('source', itemIndex) as 'url' | 'html' | 'markdown';
	const format = this.getNodeParameter('format', itemIndex) as string;
	const body: IDataObject = { format };

	if (source === 'url') {
		body.url = this.getNodeParameter('url', itemIndex) as string;
	} else if (source === 'markdown') {
		body.markdown = this.getNodeParameter('markdown', itemIndex) as string;
	} else {
		body.html = this.getNodeParameter('html', itemIndex) as string;
	}

	if (source === 'html' || source === 'markdown') {
		const templateDataRaw = this.getNodeParameter('templateData', itemIndex, '{}') as
			| string
			| IDataObject;
		const templateData =
			typeof templateDataRaw === 'string'
				? safeJsonParse.call<IExecuteFunctions, [string, IDataObject, string, number], IDataObject>(
						this,
						templateDataRaw,
						{} as IDataObject,
						'Template Data (JSON)',
						itemIndex,
					)
				: templateDataRaw;
		if (templateData && typeof templateData === 'object' && Object.keys(templateData).length > 0) {
			body.data = templateData;
		}
	}

	const additional = this.getNodeParameter(
		'additionalOptions',
		itemIndex,
		{},
	) as IDataObject;

	for (const key of ADDITIONAL_OPTION_KEYS) {
		const value = additional[key];
		if (value === undefined || value === null || value === '') continue;
		if (Array.isArray(value) && value.length === 0) continue;
		// Resize fields default to 0 in the UI to mean "unset"; never forward a 0.
		if ((key === 'resizeWidth' || key === 'resizeHeight') && value === 0) continue;
		body[key] = value;
	}

	// hideSelectors is entered as a comma/newline-separated string but the API
	// expects an array of CSS selectors.
	const hideSelectorsRaw = additional.hideSelectors;
	if (typeof hideSelectorsRaw === 'string' && hideSelectorsRaw.trim()) {
		const selectors = hideSelectorsRaw
			.split(/[\n,]/)
			.map((s) => s.trim())
			.filter(Boolean);
		if (selectors.length > 0) body.hideSelectors = selectors;
	}

	for (const key of JSON_OPTION_KEYS) {
		const raw = additional[key];
		if (raw === undefined || raw === null || raw === '') continue;
		if (typeof raw === 'string') {
			const parsed = safeJsonParse.call(this, raw, undefined, key, itemIndex);
			if (parsed !== undefined) body[key] = parsed;
		} else {
			body[key] = raw;
		}
	}

	return body;
}

const EXTRACT_OPTION_KEYS = [
	'device',
	'blockAds',
	'blockCookieBanners',
	'timeout',
	'waitUntil',
] as const;

function buildExtractBody(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const body: IDataObject = {
		url: this.getNodeParameter('url', itemIndex) as string,
		extractFormat: this.getNodeParameter('extractFormat', itemIndex, 'markdown') as string,
	};

	const additional = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;

	for (const key of EXTRACT_OPTION_KEYS) {
		const value = additional[key];
		if (value === undefined || value === null || value === '') continue;
		body[key] = value;
	}

	// hideSelectors is entered as a comma/newline-separated string but the API
	// expects an array of CSS selectors.
	const hideSelectorsRaw = additional.hideSelectors;
	if (typeof hideSelectorsRaw === 'string' && hideSelectorsRaw.trim()) {
		const selectors = hideSelectorsRaw
			.split(/[\n,]/)
			.map((s) => s.trim())
			.filter(Boolean);
		if (selectors.length > 0) body.hideSelectors = selectors;
	}

	return body;
}

// Artifact branding sub-object keys. The live /v1/artifact schema nests these
// under `branding` (logo/accentColor/font/header/footer). The older Make module
// (rendex-make/modules/renderArtifact.json) used flat title/brandName/logoUrl/
// theme names that the live API replaced with branding.header/branding.logo (and
// dropped `theme`) — these are the authoritative names from openapi.yaml.
const ARTIFACT_BRANDING_KEYS = ['logo', 'accentColor', 'font', 'header', 'footer'] as const;

function buildArtifactBody(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const body: IDataObject = {
		content: this.getNodeParameter('content', itemIndex) as string,
		inputFormat: this.getNodeParameter('inputFormat', itemIndex, 'markdown') as string,
	};

	const formats = this.getNodeParameter('formats', itemIndex, ['pdf', 'png']) as string[];
	if (Array.isArray(formats) && formats.length > 0) body.formats = formats;

	const options = this.getNodeParameter('artifactOptions', itemIndex, {}) as IDataObject;

	// Collect the optional branding fields into the nested `branding` object the
	// API expects (omit it entirely when no branding field was supplied).
	const branding: IDataObject = {};
	for (const key of ARTIFACT_BRANDING_KEYS) {
		const v = options[key];
		if (v === undefined || v === null || v === '') continue;
		branding[key] = v;
	}
	if (Object.keys(branding).length > 0) body.branding = branding;

	const expiresIn = options.expiresIn;
	if (typeof expiresIn === 'number' && expiresIn > 0) body.expiresIn = expiresIn;

	// Optional Mustache template values, entered as a JSON object.
	const dataRaw = options.data;
	if (dataRaw !== undefined && dataRaw !== null && dataRaw !== '') {
		const parsed =
			typeof dataRaw === 'string'
				? safeJsonParse.call<IExecuteFunctions, [string, IDataObject, string, number], IDataObject>(
						this,
						dataRaw,
						{},
						'Template Data (JSON)',
						itemIndex,
					)
				: (dataRaw as IDataObject);
		if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) body.data = parsed;
	}

	return body;
}

// Watch request keys that stay top-level on the body…
const WATCH_TOP_KEYS = [
	'url',
	'name',
	'intervalMinutes',
	'diffMode',
	'threshold',
	'webhookUrl',
	'notifyEmail',
	'paused',
] as const;

// …and render knobs that nest under `renderParams` (fed to the renderer each check).
const WATCH_RENDER_SCALAR_KEYS = [
	'format',
	'fullPage',
	'device',
	'darkMode',
	'blockAds',
	'blockCookieBanners',
	'selector',
	'geo',
	'minTextChars',
	'uaMode',
] as const;

// String-list render knobs split into arrays before sending (also under renderParams).
const WATCH_RENDER_LIST_KEYS = ['hideSelectors', 'ignoreText', 'suppressWhilePresent'] as const;

// Alert-channel fields a PATCH can CLEAR (the API marks them .nullable() on the
// UPDATE schema only). An empty string is indistinguishable from "leave unchanged"
// in n8n's no-code collection, so a sentinel ("-" or "none") means "unset": on
// update we emit JSON null (the route's null branch nulls the column); on create
// there is nothing to clear, so the sentinel is simply dropped. These are NOT new
// API param keys — webhookUrl/notifyEmail already live in WATCH_TOP_KEYS.
const WATCH_CLEARABLE_KEYS = new Set<string>(['webhookUrl', 'notifyEmail']);
const WATCH_CLEAR_SENTINELS = new Set<string>(['-', 'none']);

/**
 * Assemble a /v1/watches request body from a flat options object (the merged
 * Create inputs or the Update collection). Top-level keys pass through; render
 * knobs nest under `renderParams`. Empty strings/undefined are dropped, but a
 * boolean `false` (e.g. paused/fullPage) is preserved. List-style knobs are
 * split into arrays — hideSelectors on comma/newline; ignoreText and
 * suppressWhilePresent on NEWLINE only (a literal/regex may contain commas).
 * When `allowClear` is set (Update only), a clear-sentinel on webhookUrl/
 * notifyEmail emits JSON null so the no-code user can unset an alert channel.
 */
function buildWatchBody(opts: IDataObject, allowClear = false): IDataObject {
	const body: IDataObject = {};
	for (const key of WATCH_TOP_KEYS) {
		const v = opts[key];
		// Clear-channel sentinel on the nullable alert fields: null on update
		// (clears the column), dropped on create (nothing to clear yet).
		if (
			WATCH_CLEARABLE_KEYS.has(key) &&
			typeof v === 'string' &&
			WATCH_CLEAR_SENTINELS.has(v.trim().toLowerCase())
		) {
			if (allowClear) body[key] = null;
			continue;
		}
		if (v === undefined || v === null || v === '') continue;
		body[key] = v;
	}

	const renderParams: IDataObject = {};
	for (const key of WATCH_RENDER_SCALAR_KEYS) {
		const v = opts[key];
		if (v === undefined || v === null || v === '') continue;
		renderParams[key] = v;
	}

	for (const key of WATCH_RENDER_LIST_KEYS) {
		const raw = opts[key];
		if (typeof raw !== 'string' || !raw.trim()) continue;
		// hideSelectors accepts comma OR newline; the text filters split on newline
		// only (a literal/regex pattern may legitimately contain a comma).
		const arr = raw
			.split(key === 'hideSelectors' ? /[\n,]/ : '\n')
			.map((s) => s.trim())
			.filter(Boolean);
		if (arr.length > 0) renderParams[key] = arr;
	}

	if (Object.keys(renderParams).length > 0) body.renderParams = renderParams;
	return body;
}

function safeJsonParse<T>(
	this: IExecuteFunctions,
	raw: string,
	fallback: T,
	field: string,
	itemIndex: number,
): T {
	const trimmed = raw.trim();
	if (!trimmed) return fallback;
	try {
		return JSON.parse(trimmed) as T;
	} catch {
		throw new NodeOperationError(
			this.getNode(),
			`"${field}" must be valid JSON`,
			{ itemIndex },
		);
	}
}

// ─── 429 upgrade nudge ──────────────────────────────────────────────
// Pull Rendex's rate-limit / monthly-cap message + upgrade link out of a 429
// error, robust to the several shapes n8n's HTTP helper wraps errors in. Returns
// null for any non-429 so normal error handling is untouched.
function extractUpgradeNudge(error: unknown): { message: string; description: string } | null {
	const e = error as {
		httpCode?: string | number;
		statusCode?: number;
		response?: { status?: number; statusCode?: number; body?: unknown; data?: unknown };
		cause?: { response?: { body?: unknown } };
	};
	const status = Number(e?.httpCode ?? e?.statusCode ?? e?.response?.status ?? e?.response?.statusCode);
	if (status !== 429) return null;
	let body: unknown = e?.response?.body ?? e?.response?.data ?? e?.cause?.response?.body;
	if (typeof body === 'string') {
		try {
			body = JSON.parse(body);
		} catch {
			body = undefined;
		}
	}
	const apiErr = (body as { error?: { code?: string; message?: string; upgrade_url?: string } } | undefined)?.error;
	const message = apiErr?.message ?? 'Rendex rate limit reached (the free plan allows 10 requests/minute).';
	const upgradeUrl = apiErr?.upgrade_url ?? 'https://rendex.dev/pricing';
	const description =
		apiErr?.code === 'USAGE_EXCEEDED'
			? `Your monthly Rendex credit pool is used up. Upgrade for a larger pool: ${upgradeUrl}`
			: `Add a short delay between items, or upgrade for a higher rate limit: ${upgradeUrl}`;
	return { message, description };
}
