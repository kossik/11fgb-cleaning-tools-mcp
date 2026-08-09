# 11FGB Cleaning Tools MCP

Free deterministic cleaning calculators for AI assistants, agents, and web applications. The hosted server returns structured estimates, plain-text fallback answers, and optional MCP Apps visualizations.

Production endpoint: `https://mcp.11fgb.com/mcp`

Documentation and interactive calculators: [11fgb.com/developers/mcp](https://11fgb.com/developers/mcp)

## Tools

| Tool | Intended use |
| --- | --- |
| `estimate_home_cleaning_cost` | Home and apartment price, labor, crew, and duration planning |
| `estimate_office_cleaning_cost` | Per-visit and monthly office cleaning budgets |
| `estimate_cleaning_time_and_crew` | Workload, visit duration, and crew sizing |
| `calculate_cleaning_chemical_usage` | Ready-to-use solution, concentrate, water, and generic package quantities |

All results are planning estimates, not binding quotes. Product labels and Safety Data Sheets override chemical calculations. Never mix cleaning chemicals unless the manufacturer explicitly instructs it.

## Connect

Use the remote Streamable HTTP endpoint in any compatible client:

```json
{
  "mcpServers": {
    "11fgb-cleaning-tools": {
      "type": "http",
      "url": "https://mcp.11fgb.com/mcp"
    }
  }
}
```

No account or API key is required.

## Example

Ask an assistant with the MCP connected:

> Estimate a standard one-time cleaning for a 1,900 sq ft, three-bedroom, two-bath house in ZIP 78704 with one dog.

The result includes a price range, labor hours, recommended crew, expected duration, assumptions, warnings, and a 30-day visual report URL.

## Run locally

Requirements: Node.js 20+.

```bash
npm install
npm run dev
```

The development server listens on `http://localhost:3400`. Run all checks with:

```bash
npm run check
docker build -t 11fgb-cleaning-tools .
```

## Configuration

Copy `.env.example` into your own environment. Production requires a random 32-byte `REPORT_TOKEN_KEY` encoded as base64. The optional private rate feed can override the bundled national and Central Texas demonstration rate cards.

The report token contains only calculator inputs accepted by the public schemas. Exact street addresses are not accepted. Tokens are AES-256-GCM encrypted, expire after 30 days, and are not persisted as user records.

## HTTP endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /mcp` | MCP Streamable HTTP transport |
| `POST /api/v1/calculations/{calculator}` | Web calculator adapter |
| `GET /api/v1/reports/{token}` | Recompute an anonymous visual report |
| `GET /health` | Container health |
| `GET /.well-known/mcp/server-card.json` | Registry scanner fallback |
| `POST /api/v1/events` | Anonymous aggregate report interaction event |

## Methodology and data

The calculation engine is deterministic and versioned. Public fallback rates live in `data/rates.json`; hosted production may supply fresher rate cards through `CALCULATOR_DATA_URL`. A result always identifies its methodology and data version and distinguishes a verified Central Texas market from a national planning fallback.

## Privacy and security

- No user account is required.
- The server does not request or accept exact street addresses.
- Full chat prompts are not stored.
- Rate limits apply to anonymous calculations.
- Report links are encrypted and expire after 30 days.
- Security reports: [11fgb.com/contact-us](https://11fgb.com/contact-us).

## License

[MIT](LICENSE)

## Production deployment

The production workflow deploys an exact commit SHA to `/opt/11fgb-mcp`. It builds a tagged image, starts an isolated candidate on port 3401, verifies health and an MCP initialize handshake, switches the Compose service on port 3400, and retains the previous tagged image for rollback. The container is limited to 512 MB RAM and log/image rotation is bounded.
