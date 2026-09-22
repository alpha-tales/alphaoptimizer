# Jev provider

Verified against TypeSafe's first-party documentation on 21 September 2026:

- [API](https://docs.typesafe.ai/api): POST `https://api.typesafe.ai/v1/systemone`, Bearer authentication, `state`, `model`, and typed `questions`; results in `answers` keyed by question ID.
- [Models and pricing](https://docs.typesafe.ai/models): pinned `jev-1.13.0`; published price $0.042 per million input tokens, output free. This is a dated rate, not a spending guarantee.
- [Privacy](https://typesafe.ai/legal/privacy-policy): no training on inputs; retention is described as reasonably necessary, without a fixed deletion deadline. US processing. Do not assume zero retention.
- [Legal](https://docs.typesafe.ai/legal): customer agreement and DPA; zero-data-retention is an enterprise offering requiring a separate arrangement.

The integration is enabled by providing a Jev API key:

```sh
ALPHAOPTIMIZER_JEV_API_KEY=your-key
```

When the key is configured, the goal and candidate text for observations labelled `normal` may be sent to TypeSafe. Classification labels are caller-provided; `normal` is not automatic secret detection. Review the source of those labels before enabling the plugin in environments with sensitive data. Sensitive and secret observations are never sent. No outbound provider call was made during implementation; tests use synthetic responses. Credentials, account eligibility, actual charges, latency, and ranking quality remain unverified live.

Requests contain up to 40 unpinned candidates, at most 24,000 UTF-8 bytes including the question framing. Responses are bounded to 64,000 bytes; timeout is 1.5 seconds; redirects and alternative endpoints are rejected. No retries. A probability of at least 0.8 boosts optional evidence; provider judgments never unpin or remove mandatory evidence. Any provider/configuration/validation failure uses deterministic selection and reports `jev-unavailable-deterministic-fallback` in selection reasons. There is no cumulative provider spending budget; use account-level controls if you need a hard spend cap.
