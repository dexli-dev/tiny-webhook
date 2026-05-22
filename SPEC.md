# Product Spec: TinyWebhook.site

## 1. Product Summary

**TinyWebhook.site** is a simple webhook inbox for developers who need to test, inspect, and debug incoming HTTP requests.

Users create a temporary webhook URL, send requests to it, and view the received payloads in real time.

The product is intentionally small: one job, one workflow, minimal setup.

## 2. Core Value Proposition

> A temporary webhook inbox for testing bots, callbacks, and third-party integrations in seconds.

Instead of setting up a local server, exposing localhost, checking logs, or building temporary endpoints, developers can create an inbox and immediately receive and inspect webhook requests.

## 3. Target Users

Primary users:

* Solo developers
* Indie hackers
* Backend developers
* QA/test engineers
* API integration developers
* Developers testing Telegram bots, Stripe webhooks, GitHub webhooks, Cloudflare Workers, Zapier, Make, etc.

## 4. Main Use Cases

### Use Case 1: Testing third-party webhooks

A developer needs to test if Stripe, GitHub, Telegram, or another service sends the expected payload.

They create an inbox, copy the generated URL, paste it into the external service, trigger a webhook, and inspect the request.

### Use Case 2: Debugging unknown payloads

A developer is integrating with an API but does not know exactly what headers or body the service sends.

TinyWebhook captures:

* HTTP method
* Headers
* Query parameters
* Body
* Timestamp
* IP address
* Content type

### Use Case 3: Temporary callback URL

A developer needs a short-lived public endpoint for testing without deploying code.

The inbox expires automatically after a fixed time.

## 5. MVP Scope

### MVP Features

#### 1. Create webhook inbox

User clicks:

> Create Inbox

System generates a unique public URL:

```txt
https://tinywebhook.site/in/abc123
```

No account required for the free version.

#### 2. Receive HTTP requests

The generated endpoint accepts:

```txt
GET
POST
PUT
PATCH
DELETE
OPTIONS
```

Each request is stored and attached to the inbox.

#### 3. View incoming requests

Inbox page shows a list of received requests.

Each request displays:

* Timestamp
* HTTP method
* Path
* Status returned
* Source IP
* Content type
* Body size

#### 4. Request detail view

Clicking a request opens details:

* Headers
* Query parameters
* Raw body
* Pretty JSON view if applicable
* Form data if applicable
* User agent
* IP address

#### 5. Realtime updates

The inbox page updates automatically when a new request arrives.

MVP implementation can use:

```txt
Server-Sent Events
```

WebSockets are not necessary for the first version.

#### 6. Auto-expiration

Free inboxes expire after:

```txt
24 hours
```

Requests are deleted after expiration.

#### 7. Copy buttons

User can copy:

* Webhook URL
* Request body
* Headers
* cURL replay command

#### 8. Custom response basics

For MVP, every webhook endpoint returns:

```json
{
  "ok": true
}
```

With status code:

```txt
200 OK
```

Custom responses can be a paid feature later.

## 6. Non-MVP Features

These should not be built initially.

* User accounts
* Teams
* Complex dashboards
* Advanced analytics
* Webhook forwarding
* Custom domains
* OAuth integrations
* Full API management
* Collaboration features
* Alerting
* Long-term storage
* Multiple environments
* OpenAPI generation

Keep the first version tiny.

## 7. Paid Features

### Free Plan

```txt
Price: Free
Inbox lifetime: 24 hours
Requests per inbox: 10–50
Request retention: 24 hours
Authentication: None
Custom response: No
Private inbox: No
```

### Paid Plan

```txt
Price: $5/month
Inbox lifetime: 7 days
Requests per inbox: 1,000
Request retention: 7 days
Private inboxes: Yes
Custom response status: Yes
Custom response body: Yes
Request search: Yes
```

### Possible Higher Plan

```txt
Price: $12/month
Persistent inboxes
Webhook forwarding
Longer retention
Team sharing
Basic API access
```

But this should come later only if users ask for it.

## 8. User Flow

### First-time user flow

1. User lands on homepage.
2. User clicks **Create Inbox**.
3. System creates unique inbox.
4. User sees webhook URL.
5. User copies URL.
6. User sends test request.
7. Request appears instantly.
8. User opens the request and inspects payload.

No signup. No setup. No tutorial needed.

## 9. Pages

### 1. Homepage

Purpose: explain the product and get user to create an inbox.

Content:

```txt
Tiny webhook inbox for developers.
Create a temporary URL, receive webhooks, inspect requests.
```

Primary CTA:

```txt
Create Inbox
```

Secondary examples:

```bash
curl -X POST https://tinywebhook.site/in/abc123 \
  -H "Content-Type: application/json" \
  -d '{"hello":"world"}'
```

### 2. Inbox Page

URL:

```txt
/inbox/{inboxId}
```

Contains:

* Generated webhook URL
* Copy button
* Expiration timer
* Request list
* Empty state
* Realtime connection status

### 3. Request Detail Panel

Can be a side panel or expandable section.

Contains tabs:

```txt
Overview | Headers | Query | Body | cURL
```

### 4. Pricing Page

Can be added later.

For MVP, pricing can be simple and static.

## 10. Data Model

### Inbox

```txt
Id
PublicToken
CreatedAt
ExpiresAt
RequestLimit
IsPrivate
OwnerUserId nullable
CustomResponseStatus nullable
CustomResponseBody nullable
```

### WebhookRequest

```txt
Id
InboxId
ReceivedAt
Method
Path
QueryString
HeadersJson
BodyText
BodySizeBytes
ContentType
SourceIp
UserAgent
ResponseStatus
```

### User

Only needed for paid version.

```txt
Id
Email
CreatedAt
SubscriptionStatus
StripeCustomerId
```

## 11. API Endpoints

### Create inbox

```http
POST /api/inboxes
```

Response:

```json
{
  "inboxId": "abc123",
  "webhookUrl": "https://tinywebhook.site/in/abc123",
  "dashboardUrl": "https://tinywebhook.site/inbox/abc123",
  "expiresAt": "2026-05-23T12:00:00Z"
}
```

### Receive webhook

```http
ANY /in/{publicToken}
```

Stores the incoming request.

Returns:

```json
{
  "ok": true
}
```

### Get inbox

```http
GET /api/inboxes/{id}
```

Returns inbox metadata and recent requests.

### Get request details

```http
GET /api/inboxes/{id}/requests/{requestId}
```

Returns full request details.

### Realtime stream

```http
GET /api/inboxes/{id}/events
```

Uses Server-Sent Events.

## 12. Technical Stack

Recommended stack based on your preferences:

```txt
Frontend: SvelteKit
Backend: .NET 9 Minimal API
Database: PostgreSQL
Realtime: Server-Sent Events
Hosting: Dokploy / Hetzner / VPS
Reverse proxy: Traefik or NGINX
Payments later: Stripe or Lemon Squeezy
```

For very small MVP:

```txt
Storage: PostgreSQL only
Cache: Not needed
Queue: Not needed
Authentication: Not needed
```

Valkey/Redis can be added later for short-lived request storage, but PostgreSQL is enough to start.

## 13. Important Constraints

### Security

The product receives arbitrary HTTP payloads. Therefore:

* Limit body size.
* Do not execute received content.
* Escape all rendered HTML.
* Treat all request bodies as untrusted text.
* Do not automatically follow URLs from payloads.
* Rate-limit inbox creation.
* Rate-limit requests per inbox.
* Delete expired data regularly.

Recommended MVP limits:

```txt
Max body size: 256 KB
Max requests per free inbox: 50
Inbox lifetime: 24 hours
IP rate limit: 20 inboxes/hour
```

### Privacy

Homepage should clearly say:

```txt
Do not send passwords, API keys, production secrets, or personal data.
Temporary inboxes are for testing only.
```

### Abuse Prevention

Because public endpoints can be abused:

* Add global rate limits.
* Block oversized payloads.
* Expire inboxes.
* Limit request count.
* Add basic bot protection to inbox creation if abused.
* Do not allow file uploads in MVP.

## 14. Success Metrics

For the MVP, track:

```txt
Inboxes created per day
Requests received per day
Percentage of inboxes receiving at least one request
Average requests per inbox
Return users
Paid conversions later
```

Most important early metric:

> How many created inboxes receive at least one webhook?

That shows whether users understand and use the product.

## 15. MVP Build Order

### Phase 1: Core backend

* Create inbox endpoint
* Receive webhook endpoint
* Store request metadata and body
* Auto-expiration logic

### Phase 2: Basic frontend

* Homepage
* Inbox page
* Request list
* Request detail view
* Copy buttons

### Phase 3: Realtime

* Add Server-Sent Events
* Show new requests live

### Phase 4: Safety and limits

* Body size limit
* Request count limit
* IP rate limits
* Expired data cleanup

### Phase 5: Paid version

* Add accounts
* Add subscriptions
* Add private inboxes
* Add custom response status/body
* Add longer retention

## 16. Positioning

Main headline:

> Test webhooks in seconds.

Subheadline:

> Create a temporary endpoint, receive HTTP requests, and inspect payloads instantly.

Alternative headlines:

```txt
A tiny webhook inbox for developers.
Temporary webhook URLs for testing and debugging.
Inspect incoming webhooks without deploying anything.
```

## 17. Competitive Angle

This does not need to beat large tools.

It wins by being:

```txt
Simpler
Cheaper
Faster
Less cluttered
Developer-focused
No signup required
```

The goal is not to become a full webhook platform.

The goal is to be the tiny tool developers remember when they need to quickly inspect an HTTP callback.

## 18. Product Rule

The product should obey one strict rule:

> A new user should understand and use it successfully within 30 seconds.

If a feature makes that harder, do not add it yet.
