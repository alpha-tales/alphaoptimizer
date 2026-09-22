# Contributing

Run these checks before proposing changes:

```bash
npm test
npm run typecheck
npm run build
python3 /Users/libinjoseph/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py /Users/libinjoseph/Projects/AlphaOptimizer
```

Keep changes conservative: preserve raw evidence, prefer explicit scope checks, and do not enable
hook replacement or external providers without reproducible compatibility evidence.
