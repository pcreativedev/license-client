# @pcreative/license-client

License verification client for **pcreative.dev** templates.

- 🔐 **RS256 JWT** signatures verified locally with embedded public key
- 🌐 **Offline-capable** — once activated, no network needed
- 💔 **Soft-kill state machine** — active → grace (7d) → degraded (30d) → invalid
- 🔍 **Watermark tracking** — each license has a unique ID embedded in the JWT
- 📦 **Domain binding** — JWT is bound to a specific domain at activation time

## Install

```bash
npm install @pcreative/license-client
# or
bun add @pcreative/license-client
```

## Usage (server-side, Next.js / Express / Node)

```typescript
import { activateLicense, getLicenseState, heartbeat } from "@pcreative/license-client";

// 1. First activation (e.g., in your /setup wizard)
const result = await activateLicense({
  licenseKey: "AURORA-XXXX-XXXX",
  product: "aurora",
  domain: "yoursite.com",
});

if (result.valid) {
  // JWT now stored in .pcreative-license.json at project root
}

// 2. On every request / startup, check state
const state = await getLicenseState("aurora");
switch (state.status) {
  case "missing": /* redirect to /setup */ break;
  case "active": /* normal */ break;
  case "grace": /* show banner: state.daysLeft */ break;
  case "degraded": /* random failures (soft-kill phase) */ break;
  case "invalid": /* block */ break;
}

// 3. Daily heartbeat (cron / setInterval)
await heartbeat();
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PCREATIVE_LICENSE_API` | `https://api.pcreative.dev` | License API base URL |
| `PCREATIVE_LICENSE_DOMAIN` | `request.host` | Override domain detection |

## License

MIT — see [LICENSE](./LICENSE)
