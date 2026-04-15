import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export class Rendex implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Rendex',
		name: 'rendex',
		icon: 'file:rendex.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Capture screenshots, generate PDFs, and render HTML via Rendex',
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
		requestDefaults: {
			baseURL: '={{$credentials.baseUrl}}',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		properties: [
			// ─── Resource ──────────────────────────────────────────────
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Screenshot', value: 'screenshot' },
					{ name: 'Job', value: 'job' },
					{ name: 'Batch', value: 'batch' },
				],
				default: 'screenshot',
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
				],
				default: 'capture',
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
				],
				default: 'url',
				description: 'Whether to capture a live URL or render raw HTML',
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
						operation: ['capture', 'captureAsync'],
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
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

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
							url: '/v1/screenshot/json',
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
							url: '/v1/screenshot',
							body,
							json: true,
						} as IHttpRequestOptions,
					)) as IDataObject;

					returnData.push({
						json: response,
						pairedItem: { item: i },
					});
				} else if (resource === 'job' && operation === 'getStatus') {
					const jobId = this.getNodeParameter('jobId', i) as string;
					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rendexApi',
						{
							method: 'GET',
							url: `/v1/jobs/${encodeURIComponent(jobId)}`,
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
							url: '/v1/screenshot/batch',
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
							url: `/v1/batches/${encodeURIComponent(batchId)}`,
							json: true,
						} as IHttpRequestOptions,
					)) as IDataObject;

					returnData.push({ json: response, pairedItem: { item: i } });
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`Unknown operation "${resource}.${operation}"`,
						{ itemIndex: i },
					);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
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
	'darkMode',
	'quality',
	'selector',
	'waitUntil',
	'timeout',
	'delay',
	'waitForSelector',
	'bestAttempt',
	'blockAds',
	'blockResourceTypes',
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
	const source = this.getNodeParameter('source', itemIndex) as 'url' | 'html';
	const format = this.getNodeParameter('format', itemIndex) as string;
	const body: IDataObject = { format };

	if (source === 'url') {
		body.url = this.getNodeParameter('url', itemIndex) as string;
	} else {
		body.html = this.getNodeParameter('html', itemIndex) as string;
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
		body[key] = value;
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
