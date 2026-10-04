import { defineCsrfExempt } from '@core/module-kit';

/**
 * Routes external systems call without the CSRF pair (extension point 17). Each one is anonymous
 * — the API ignores cookie sessions on it — and must prove its caller by itself.
 */
export default defineCsrfExempt('Example', [
  {
    method: 'POST',
    path: '/inbound/inquiries',
    reason:
      'Signed with HMAC-SHA256 (X-Example-Signature) using the example.inbound_secret setting.',
  },
]);
