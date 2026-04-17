# Contextual Access — real webhook, not simulated

This app implements Arcade's Contextual Access webhook contract
(`logic_extensions/http/1.0` v1.1.1-beta). When registered as a Logic
Extension on your Arcade gateway, policy enforcement runs at Arcade's edge
— not ours.

## Endpoints

| Method | Path                              | Purpose                                    |
|--------|-----------------------------------|--------------------------------------------|
| GET    | `/api/arcade/hooks/health`        | health check                               |
| POST   | `/api/arcade/hooks/access`        | tool visibility (currently allow-all)      |
| POST   | `/api/arcade/hooks/pre`           | pre-execution policy chain                 |
| POST   | `/api/arcade/hooks/post`          | post-execution (pass-through for now)      |

Auth: bearer token in the `Authorization` header. Set the shared secret in
`.env` as `ARCADE_HOOKS_TOKEN`. When the env var is unset, the endpoints
accept all requests (dev only — warning logged).

## Policies implemented at the gateway

| ID                       | Effect                                          |
|--------------------------|-------------------------------------------------|
| `pii-outbound`           | Blocks outbound messages containing SSN or CC numbers |
| `internal-only-outbound` | Restricts Gmail sends to `@INTERNAL_DOMAIN` (default `arcade.dev`) |

`high-risk-needs-mfa` is intentionally NOT enforced at the gateway. Arcade's
webhook API is synchronous (5s timeout) with no native way to pause for an
out-of-band MFA approval, so step-up is client-orchestrated in
`/api/action`. That limitation is my feature-request for Arcade.

## Register the extension (Arcade dashboard)

1. Deploy this app to a publicly reachable URL (Vercel preview URL works; for
   local dev use ngrok: `ngrok http 8765`).
2. Go to `app.arcade.dev` → Extensions → New Logic Extension.
3. Set:
   - **Base URL**: `https://<your-app-url>/api/arcade/hooks`
   - **Auth**: Bearer
   - **Token**: whatever you put in `ARCADE_HOOKS_TOKEN`
   - **Failure mode**: `fail-closed` for pre (security-critical), `fail-open`
     for access/post (optional).
4. Attach the extension to your gateway with hook order priorities of 0.
5. Verify with `curl https://<your-app-url>/api/arcade/hooks/health`.

Once registered, every tool call through the gateway — including the write
tools this app uses (`Gmail_SendEmail`, `Slack_SendMessage`,
`Github_CreateIssueComment`, `Linear_CreateComment`) — runs the policy chain
at Arcade's edge. Denials surface as `CHECK_FAILED` with
`error_message: "[policy-id] reason"`.

## Smoke tests (against localhost)

```bash
# happy path — internal Gmail
curl -s -X POST localhost:8765/api/arcade/hooks/pre \
  -H "Content-Type: application/json" \
  -d '{"execution_id":"t1","tool":{"name":"Gmail_SendEmail","toolkit":"gmail","version":"1"},
       "inputs":{"body":"Hi jane@arcade.dev"}}'
# → {"code":"OK"}

# external domain blocked
curl -s -X POST localhost:8765/api/arcade/hooks/pre \
  -H "Content-Type: application/json" \
  -d '{"execution_id":"t2","tool":{"name":"Gmail_SendEmail","toolkit":"gmail","version":"1"},
       "inputs":{"body":"Hi partner@competitor.com"}}'
# → {"code":"CHECK_FAILED","error_message":"[internal-only-outbound] ..."}

# DLP blocked
curl -s -X POST localhost:8765/api/arcade/hooks/pre \
  -H "Content-Type: application/json" \
  -d '{"execution_id":"t3","tool":{"name":"Slack_SendMessage","toolkit":"slack","version":"1"},
       "inputs":{"text":"SSN is 123-45-6789"}}'
# → {"code":"CHECK_FAILED","error_message":"[pii-outbound] ..."}
```
