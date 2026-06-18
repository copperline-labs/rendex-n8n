import type {
	IDataObject,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

/**
 * Best-effort change enrichment. Given a watchId, fetch its latest runs and
 * merge the details of the run that SET `lastChangedAt` onto the emitted item —
 * so a no-coder gets the before/after images + diff magnitude in one step,
 * without a second "Get watch runs" node.
 *
 * Runs come back newest-first (created_at DESC), so the first `changed === true`
 * item is the run that produced the current change. Returns the merge fields, or
 * `{}` when there is no changed run OR on ANY error — the error is swallowed so a
 * failed enrichment can never break the poll (the item is still emitted, just
 * with the watch-level fields only). These are RESPONSE fields, not request
 * params, so they are additive to the emitted shape and outside param parity.
 */
async function enrichChange(
	ctx: IPollFunctions,
	baseUrl: string,
	watchId: string,
): Promise<IDataObject> {
	try {
		const res = (await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'rendexApi', {
			method: 'GET',
			url: `${baseUrl}/v1/watches/${encodeURIComponent(watchId)}/runs`,
			qs: { limit: 5 },
			json: true,
		} as IHttpRequestOptions)) as { data?: { items?: IDataObject[] } };
		const run = (res.data?.items ?? []).find((r) => r.changed === true);
		if (!run) return {};
		return {
			runId: run.id,
			diffScore: run.diffScore,
			diffPixels: run.diffPixels,
			beforeUrl: run.beforeUrl,
			afterUrl: run.afterUrl,
			diffOverlayUrl: run.diffOverlayUrl,
			textDiff: run.textDiff,
			completedAt: run.completedAt,
		};
	} catch {
		// Best-effort: any failure (network, 4xx/5xx, parse) degrades to
		// watch-level fields only. Never throw — the poll must still fire.
		return {};
	}
}

/**
 * Polling trigger for Rendex Watch. On each poll it reads the caller's watches
 * and fires for any whose `lastChangedAt` advanced since the previous poll —
 * the async-job polling pattern (NOT a REST hook). For real-time, low-latency
 * delivery, configure the watch's own `webhookUrl` to point at an n8n Webhook
 * node instead; this trigger is the zero-config alternative.
 */
export class RendexWatchTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Rendex Watch Trigger',
		name: 'rendexWatchTrigger',
		icon: 'file:rendex.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{"When a watched page changes"}}',
		description: 'Starts the workflow when a monitored page changes',
		defaults: {
			name: 'Rendex Watch Trigger',
		},
		polling: true,
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'rendexApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Watch ID',
				name: 'watchId',
				type: 'string',
				default: '',
				placeholder: 'Leave empty to watch all of your watches',
				description:
					'Optional — a single watch ID to monitor. Leave empty to fire whenever ANY of your active watches changes.',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const credentials = await this.getCredentials('rendexApi');
		const baseUrl = ((credentials.baseUrl as string) || 'https://api.rendex.dev').replace(/\/+$/, '');
		const watchId = (this.getNodeParameter('watchId', '') as string).trim();
		const staticData = this.getWorkflowStaticData('node');
		// High-water mark as epoch ms — a numeric instant, so comparison never depends
		// on ISO offset/fraction formatting (the API returns +00:00 strings).
		const lastSeenMs = (staticData.lastChangedMs as number) || 0;
		const manualMode = this.getMode() === 'manual';

		// Pull the current state — a single watch, or ALL active watches (paged: the
		// API caps a page at 100 by created_at DESC, so a single fetch would silently
		// drop the oldest watches on accounts past 100 — follow nextCursor to the end).
		let watches: IDataObject[];
		try {
			if (watchId) {
				const res = (await this.helpers.httpRequestWithAuthentication.call(this, 'rendexApi', {
					method: 'GET',
					url: `${baseUrl}/v1/watches/${encodeURIComponent(watchId)}`,
					json: true,
				} as IHttpRequestOptions)) as { data?: IDataObject };
				watches = res.data ? [res.data] : [];
			} else {
				watches = [];
				let cursor: string | undefined;
				// Bound the loop well above the max per-user watch cap (1000) as a backstop.
				for (let page = 0; page < 40; page++) {
					const qs: IDataObject = { status: 'active', limit: 100 };
					if (cursor) qs.cursor = cursor;
					const res = (await this.helpers.httpRequestWithAuthentication.call(this, 'rendexApi', {
						method: 'GET',
						url: `${baseUrl}/v1/watches`,
						qs,
						json: true,
					} as IHttpRequestOptions)) as { data?: { items?: IDataObject[]; nextCursor?: string | null } };
					watches.push(...(res.data?.items ?? []));
					cursor = res.data?.nextCursor ?? undefined;
					if (!cursor) break;
				}
			}
		} catch (error) {
			throw new NodeApiError(this.getNode(), error as JsonObject);
		}

		const changedMs = (w: IDataObject): number => {
			const t = w.lastChangedAt as string | null;
			const ms = t ? Date.parse(t) : NaN;
			return Number.isNaN(ms) ? 0 : ms;
		};
		const withChange = watches.filter((w) => changedMs(w) > 0);

		// Manual test run: surface the most-recently-changed watch (or the most
		// recent watch) as sample data WITHOUT advancing the high-water mark.
		if (manualMode) {
			const sample =
				withChange.length > 0
					? withChange.reduce((a, b) => (changedMs(a) >= changedMs(b) ? a : b))
					: watches[0];
			if (!sample) return null;
			// Enrich the sample too, so a test run shows the full emitted shape.
			return [[{ json: { ...sample, ...(await enrichChange(this, baseUrl, sample.id as string)) } }]];
		}

		const maxChangedMs = withChange.reduce((max, w) => Math.max(max, changedMs(w)), 0);

		// First automatic poll (activation): record the baseline silently so we
		// never replay the existing change history when the workflow turns on.
		if (!lastSeenMs) {
			staticData.lastChangedMs = maxChangedMs || Date.now();
			return null;
		}

		const fresh = withChange.filter((w) => changedMs(w) > lastSeenMs);
		if (maxChangedMs > lastSeenMs) staticData.lastChangedMs = maxChangedMs;
		if (fresh.length === 0) return null;

		// Enrich each emitted change with the details of the run that set
		// `lastChangedAt` (before/after images, diff magnitude). Bound the work to
		// the 25 most-recently-changed watches per poll, fetched in PARALLEL: a real
		// monitoring account never sees >25 new changes within a single poll interval,
		// and the high-water mark + n8n's own dedup carry any tail forward to later
		// polls. The tail (implausible) is emitted with watch-level fields only.
		const ENRICH_CAP = 25;
		const ordered = [...fresh].sort((a, b) => changedMs(b) - changedMs(a));
		const enriched = await Promise.all(
			ordered.slice(0, ENRICH_CAP).map(async (w) => ({
				json: { ...w, ...(await enrichChange(this, baseUrl, w.id as string)) },
			})),
		);
		const tail = ordered.slice(ENRICH_CAP).map((w) => ({ json: w }));
		return [[...enriched, ...tail]];
	}
}
