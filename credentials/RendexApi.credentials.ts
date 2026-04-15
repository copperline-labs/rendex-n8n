import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class RendexApi implements ICredentialType {
	name = 'rendexApi';

	displayName = 'Rendex API';

	documentationUrl = 'https://rendex.dev/docs/authentication';

	icon = 'file:rendex.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your Rendex API key. Create one at <a href="https://rendex.dev/dashboard/keys" target="_blank">rendex.dev/dashboard/keys</a>. Starts with <code>rdx_</code>.',
			placeholder: 'rdx_...',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.rendex.dev',
			description: 'Override the Rendex API base URL. Leave as default unless self-hosting.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/jobs/credential-check',
			method: 'GET',
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message: 'Invalid API key — check your key at rendex.dev/dashboard/keys',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 403,
					message: 'API key is disabled or revoked',
				},
			},
		],
	};
}
