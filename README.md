# @pcreative/license-client

License verification client for **pcreative.dev** templates.

## Install

```bash
npm install @pcreative/license-client
```

## Quick start

```typescript
import { activateLicense, getLicenseState } from "@pcreative/license-client";

// In your setup wizard
const result = await activateLicense({
  licenseKey: "YOUR-LICENSE-KEY",
  product: "your-product-id",
  domain: "yoursite.com",
});

// On every request
const state = await getLicenseState("your-product-id");
if (state.status !== "active") {
  // handle accordingly
}
```

## API

| Function | Purpose |
|---|---|
| `activateLicense(input)` | Activate a license against the pcreative.dev API |
| `getLicenseState(product)` | Check current license status |
| `heartbeat()` | Refresh license (call periodically) |
| `isLicensed(product)` | Boolean helper |

## Environment

| Variable | Default |
|---|---|
| `PCREATIVE_LICENSE_API` | `https://api.pcreative.dev` |

## License

See [LICENSE](./LICENSE) — pcreative License (PCL) v1.0
