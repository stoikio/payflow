# PayFlow API reference

PayFlow collects payments by bank debit (SEPA Core). A payer authorizes a **mandate** once on a
PayFlow-hosted page; the merchant then creates **charges** against that mandate. Changes to
mandates and charges are published as **events** and delivered by **webhook**.

This reference is also served by the sandbox at
[http://localhost:4010/docs](http://localhost:4010/docs).

- [TL;DR](#tldr)
- [Basics](#basics): base URL, authentication, errors, rate limits, idempotency, pagination
- [Mandates](#mandates)
- [Charges](#charges)
- [Failure codes](#failure-codes)
- [Events and webhooks](#events-and-webhooks): event types, delivery, retries, signatures
- [Webhook deliveries](#webhook-deliveries)
- [Testing](#testing): sandbox IBANs, accelerated time, chaos mode, sandbox endpoints, dashboard

## TL;DR

- **Base URL:** `http://localhost:4010`. JSON in and out. Amounts in cents, dates in UTC.
- **Auth:** `Authorization: Bearer sk_sandbox_9f3c2e7a41b84d6f` on every API call. `/docs`, `/dashboard` and the hosted authorization page need no key.
- **Flow:** create a mandate, send the payer to its `authorizationUrl`, then create charges once the mandate is `active`. Every status change is published as an event and POSTed to your webhook.
- **Webhooks:** signed with `PayFlow-Signature`, delivered at least once, in no guaranteed order. Secret: `whsec_sandbox_5d1e8b3a9c7f4026`.
- **Sandbox:** no money moves. A status changes every 5 seconds, whatever the dates.

| Route                                   | Purpose                                              |
| --------------------------------------- | ---------------------------------------------------- |
| `POST /mandates`                        | Create a mandate, returns the `authorizationUrl`     |
| `GET /mandates/{id}`                    | Retrieve a mandate and its status                    |
| `POST /mandates/{id}/cancel`            | Cancel a mandate                                     |
| `POST /charges`                         | Create a charge (`Idempotency-Key` header required)  |
| `GET /charges/{id}`                     | Retrieve a charge and its status                     |
| `POST /charges/{id}/cancel`             | Cancel a charge still in `pending_submission`         |
| `GET /events`                           | List events                                          |
| `GET /events/{id}/deliveries`           | List the webhook deliveries of an event              |
| `POST /sandbox/events/{id}/replay`      | Send an event again                                  |
| `POST /sandbox/charges/{id}/transition` | Force a charge to a given status                     |

Events: `mandate.active`, `mandate.failed`, `mandate.cancelled`, `charge.submitted`,
`charge.confirmed`, `charge.paid_out`, `charge.failed`, `charge.charged_back`, `charge.cancelled`.

The outcome of a mandate and of its charges depends on the IBAN entered on the hosted page:

| IBAN                 | Outcome                                           |
| -------------------- | ------------------------------------------------- |
| `NL19PAYF0000000001` | Every charge reaches `paid_out`                   |
| `NL89PAYF0000000002` | Every charge fails with `insufficient_funds`      |
| `NL62PAYF0000000003` | First charge fails, the next ones reach `paid_out`|
| `NL35PAYF0000000004` | Charge fails with `account_closed`, mandate cancelled |
| `NL08PAYF0000000005` | Every charge fails with `refer_to_payer`          |
| `NL78PAYF0000000006` | Every charge fails with no failure code           |
| `NL51PAYF0000000007` | Charge is paid out, then `charged_back`           |
| `NL24PAYF0000000008` | The mandate itself fails                          |
| `NL94PAYF0000000009` | Mandate is cancelled by the payer after activation|

Details: [Testing](#testing).

## Basics

### Base URL

```
http://localhost:4010
```

All request and response bodies are JSON (`Content-Type: application/json`). Amounts are integers
in the currency's minor unit (cents). Timestamps are ISO 8601 in UTC, dates are `YYYY-MM-DD`.

### Authentication

Every API request carries the secret API key as a bearer token:

```
Authorization: Bearer sk_sandbox_9f3c2e7a41b84d6f
```

```sh
curl http://localhost:4010/mandates \
  -H "Authorization: Bearer $PAYFLOW_API_KEY"
```

A missing or wrong key returns `401` with `authentication_error`. The hosted authorization page,
the dashboard and this documentation do not use the key.

### Errors

Errors use conventional HTTP status codes and a common body:

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "mandate_not_active",
    "message": "Mandate MD7Q2V0K8B5N3XHT is cancelled",
    "param": "mandateId"
  }
}
```

| Status | `type`                  | Meaning                                                   |
| ------ | ----------------------- | --------------------------------------------------------- |
| 400    | `invalid_request_error` | Malformed request: invalid JSON, missing or invalid field |
| 401    | `authentication_error`  | Missing or invalid API key                                |
| 404    | `invalid_request_error` | Unknown resource (`resource_missing`) or route            |
| 422    | `invalid_request_error` | Valid request refused in the current state                |
| 429    | `rate_limit_error`      | Rate limit exceeded                                       |
| 500    | `api_error`             | Error on PayFlow's side                                   |

`param` names the offending field when there is one. Some errors carry extra fields, such as
`earliestChargeDate` on `charge_date_too_early`.

Codes common to every endpoint:

| Code                | Status | When                                                   |
| ------------------- | ------ | ------------------------------------------------------ |
| `invalid_json`      | 400    | The body is not valid JSON                             |
| `validation_failed` | 400    | A body field or query parameter is missing or invalid  |
| `invalid_api_key`   | 401    | No `Authorization` header, or an unknown key           |
| `resource_missing`  | 404    | No object with this id                                 |
| `route_not_found`   | 404    | No such route                                          |
| `rate_limited`      | 429    | See [Rate limits](#rate-limits)                        |
| `internal_error`    | 500    | Unexpected error                                       |

Codes specific to an endpoint are listed with it.

### Rate limits

100 requests per second per API key. Every API response carries `RateLimit-Limit` and
`RateLimit-Remaining`. Over the limit, PayFlow answers `429` with a `Retry-After` header in
seconds:

```
HTTP/1.1 429 Too Many Requests
RateLimit-Limit: 100
RateLimit-Remaining: 0
Retry-After: 1
```

```json
{
  "error": {
    "type": "rate_limit_error",
    "code": "rate_limited",
    "message": "Too many requests: the limit is 100 per second"
  }
}
```

### Idempotency

`POST /charges` requires an `Idempotency-Key` header (1 to 255 characters).

- The same key with the same body within 24 hours returns the original response, with the same
  charge, and the header `Idempotent-Replayed: true`. No new charge is created.
- The same key with a different body returns `422 idempotency_key_reused`.
- Only successful responses are stored: a request refused with a `4xx` can be retried with the
  same key.

### Pagination

List endpoints return the newest objects first:

```json
{ "data": [ ... ], "hasMore": true }
```

| Query parameter | Description                                             |
| --------------- | ------------------------------------------------------- |
| `limit`         | 1 to 100, default 20                                    |
| `startingAfter` | Id of the last object of the previous page              |

```sh
curl "http://localhost:4010/charges?limit=50&startingAfter=CH3M9R6TQ1W4ZP0D" \
  -H "Authorization: Bearer $PAYFLOW_API_KEY"
```

## Mandates

A mandate is the payer's authorization to debit their bank account.

### The mandate object

```json
{
  "id": "MD7Q2V0K8B5N3XHT",
  "customerReference": "client-0042",
  "status": "active",
  "authorizationUrl": "http://localhost:4010/authorize/2y8yQ0bS3n1Q...",
  "returnUrl": "https://merchant.example/debit/return",
  "bankAccount": { "accountHolderName": "Jane Doe", "country": "NL", "ibanLast4": "0001" },
  "failureCode": null,
  "cancellationReason": null,
  "metadata": {},
  "createdAt": "2026-10-22T09:00:00.000Z",
  "updatedAt": "2026-10-22T09:00:05.000Z"
}
```

| Field                | Description                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| `customerReference`  | Your reference for the payer, as sent on creation                        |
| `status`             | See below                                                                |
| `authorizationUrl`   | Hosted page where the payer enters their IBAN and confirms               |
| `bankAccount`        | `null` until the payer confirmed                                         |
| `failureCode`        | Set when `status` is `failed`: `invalid_bank_details`                    |
| `cancellationReason` | Set when `status` is `cancelled`: `cancelled_by_merchant`, `cancelled_by_payer`, `bank_account_closed` |
| `metadata`           | Up to 20 string key-value pairs                                          |

### Mandate statuses

| Status                      | Meaning                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| `pending_customer_approval` | Created, the payer has not confirmed the hosted page yet         |
| `pending_submission`        | Confirmed by the payer, being set up with the payer's bank       |
| `active`                    | Charges can be created                                           |
| `failed`                    | The payer's bank refused the mandate. Final                      |
| `cancelled`                 | No new charge possible. Final                                    |

```
                                                  +--> failed
                                                  |
pending_customer_approval --> pending_submission -+--> active
            |                         |                  |
            v                         v                  v
        cancelled                 cancelled          cancelled
```

A mandate can be cancelled from any non-final status. Cancelling a mandate fails its charges in
`pending_submission` or `submitted` with `mandate_cancelled`.

### Create a mandate

`POST /mandates`

| Body field          | Type   | Required | Description                         |
| ------------------- | ------ | -------- | ----------------------------------- |
| `customerReference` | string | yes      | 1 to 100 characters                 |
| `returnUrl`         | URL    | yes      | Where the payer is sent after confirming |
| `metadata`          | object | no       | String values                       |

```sh
curl -X POST http://localhost:4010/mandates \
  -H "Authorization: Bearer $PAYFLOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "customerReference": "client-0042", "returnUrl": "https://merchant.example/debit/return" }'
```

Returns `201` with the mandate, in `pending_customer_approval`.

### Hosted authorization page

Send the payer to `authorizationUrl`. The page asks for the account holder name and the IBAN.
On confirmation the mandate moves to `pending_submission` and the payer's browser is redirected
(`303`) to `returnUrl` with the mandate id added to the query string:

```
https://merchant.example/debit/return?mandateId=MD7Q2V0K8B5N3XHT
```

An authorization link can be used once. The redirect does not mean the mandate is active.

### Retrieve a mandate

`GET /mandates/{id}`

```sh
curl http://localhost:4010/mandates/MD7Q2V0K8B5N3XHT \
  -H "Authorization: Bearer $PAYFLOW_API_KEY"
```

### List mandates

`GET /mandates?customerReference=client-0042`

Optional filter `customerReference`, plus pagination parameters.

```sh
curl "http://localhost:4010/mandates?customerReference=client-0042" \
  -H "Authorization: Bearer $PAYFLOW_API_KEY"
```

### Cancel a mandate

`POST /mandates/{id}/cancel`

```sh
curl -X POST http://localhost:4010/mandates/MD7Q2V0K8B5N3XHT/cancel \
  -H "Authorization: Bearer $PAYFLOW_API_KEY"
```

Returns the mandate with `status: cancelled` and `cancellationReason: cancelled_by_merchant`.
`422 mandate_not_cancellable` when it is already `failed` or `cancelled`.

## Charges

A charge debits an amount from the payer's account on a mandate.

### The charge object

```json
{
  "id": "CH3M9R6TQ1W4ZP0D",
  "mandateId": "MD7Q2V0K8B5N3XHT",
  "amount": 12000,
  "currency": "EUR",
  "chargeDate": "2026-10-27",
  "description": "Annual premium",
  "metadata": {},
  "status": "pending_submission",
  "failureCode": null,
  "createdAt": "2026-10-22T09:00:10.000Z",
  "updatedAt": "2026-10-22T09:00:10.000Z"
}
```

| Field         | Description                                                         |
| ------------- | ------------------------------------------------------------------- |
| `amount`      | Minor units                                                         |
| `chargeDate`  | Date the payer's account is debited                                 |
| `description` | Shown on the payer's bank statement, `null` when not sent          |
| `status`      | See below                                                           |
| `failureCode` | Set when `status` is `failed`, see [Failure codes](#failure-codes)  |
| `metadata`    | Up to 20 string key-value pairs                                     |

### Charge statuses

| Status               | Meaning                                                               |
| -------------------- | --------------------------------------------------------------------- |
| `pending_submission` | Created, waiting to be sent to the banking network. Can be cancelled  |
| `submitted`          | Sent to the payer's bank                                              |
| `confirmed`          | Collected from the payer's account                                    |
| `paid_out`           | Paid out to the merchant's account                                    |
| `failed`             | Not collected. `failureCode` says why, and may be `null`. Final       |
| `charged_back`       | The payer disputed a collected charge with their bank. Final          |
| `cancelled`          | Cancelled before submission. Final                                    |

```
     pending_submission --> submitted --> confirmed --> paid_out
        |           |           |            |             |
        v           v           v            v             v
    cancelled    failed      failed     charged_back  charged_back
```

A `pending_submission` charge becomes `failed` when its mandate is cancelled
(`mandate_cancelled`).

### Timings

| Step                          | Live timing                                                     |
| ----------------------------- | --------------------------------------------------------------- |
| `chargeDate`                  | At least 3 business days after the request (Monday to Friday)   |
| `submitted`                   | On the business day before `chargeDate`                         |
| `confirmed` or `failed`       | 2 to 5 business days after `chargeDate`                         |
| `paid_out`                    | 1 to 2 business days after `confirmed`                          |
| `charged_back`                | Up to 8 weeks after `confirmed`, including after `paid_out`     |

The sandbox replaces these timings, see [Accelerated time](#accelerated-time).

### Create a charge

`POST /charges`

| Header            | Required | Description                     |
| ----------------- | -------- | ------------------------------- |
| `Idempotency-Key` | yes      | See [Idempotency](#idempotency) |

| Body field    | Type    | Required | Description                                                   |
| ------------- | ------- | -------- | ------------------------------------------------------------- |
| `mandateId`   | string  | yes      | An `active` mandate                                           |
| `amount`      | integer | yes      | Minor units, 1 to 50,000,000                                  |
| `currency`    | string  | yes      | `EUR`                                                         |
| `chargeDate`  | date    | no       | Defaults to the earliest possible date                        |
| `description` | string  | no       | Up to 140 characters, shown on the payer's bank statement     |
| `metadata`    | object  | no       | String values                                                 |

```sh
curl -X POST http://localhost:4010/charges \
  -H "Authorization: Bearer $PAYFLOW_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 5d2b0c8e-8f43-4a8e-9a43-0f6f7e2f1c11" \
  -d '{ "mandateId": "MD7Q2V0K8B5N3XHT", "amount": 12000, "currency": "EUR" }'
```

Returns `201` with the charge, in `pending_submission`.

| Error code                | Status | When                                                        |
| ------------------------- | ------ | ----------------------------------------------------------- |
| `idempotency_key_missing` | 400    | No `Idempotency-Key` header                                 |
| `validation_failed`       | 400    | A field is missing or invalid                               |
| `resource_missing`        | 404    | Unknown `mandateId`                                         |
| `mandate_not_active`      | 422    | The mandate is not `active`                                 |
| `unsupported_currency`    | 422    | `currency` is not `EUR`                                     |
| `charge_date_too_early`   | 422    | `chargeDate` is before `earliestChargeDate` (in the error)  |
| `idempotency_key_reused`  | 422    | Same key, different body                                    |

### Retrieve a charge

`GET /charges/{id}`

```sh
curl http://localhost:4010/charges/CH3M9R6TQ1W4ZP0D \
  -H "Authorization: Bearer $PAYFLOW_API_KEY"
```

### List charges

`GET /charges?mandateId=MD7Q2V0K8B5N3XHT`

Optional filter `mandateId`, plus pagination parameters.

```sh
curl "http://localhost:4010/charges?mandateId=MD7Q2V0K8B5N3XHT" \
  -H "Authorization: Bearer $PAYFLOW_API_KEY"
```

### Cancel a charge

`POST /charges/{id}/cancel`

```sh
curl -X POST http://localhost:4010/charges/CH3M9R6TQ1W4ZP0D/cancel \
  -H "Authorization: Bearer $PAYFLOW_API_KEY"
```

Only in `pending_submission`. Otherwise `422 charge_not_cancellable`.

## Failure codes

`failureCode` on a `failed` charge:

| Code                 | Meaning                                                                  | Retryable |
| -------------------- | ------------------------------------------------------------------------ | --------- |
| `insufficient_funds` | The payer's account did not have enough funds                            | Yes       |
| `account_closed`     | The payer's account is closed. The mandate is cancelled as well          | No        |
| `mandate_cancelled`  | The mandate was cancelled before the charge was collected                | No        |
| `refer_to_payer`     | The payer's bank refused the debit without giving a reason               | No        |
| `null`               | The bank returned the debit without a reason code                        | No        |

A retry is a new charge on the same mandate, with a new `Idempotency-Key`.

## Events and webhooks

### The event object

```json
{
  "id": "EV0B4K7N2Q9T5W8X",
  "type": "charge.confirmed",
  "createdAt": "2026-10-22T09:00:20.000Z",
  "resourceType": "charge",
  "data": { "id": "CH3M9R6TQ1W4ZP0D", "status": "confirmed", "...": "..." }
}
```

| Field          | Description                                               |
| -------------- | --------------------------------------------------------- |
| `type`         | See [Event types](#event-types)                           |
| `resourceType` | `mandate` or `charge`                                     |
| `data`         | The full mandate or charge as it was when the event happened |

### Event types

| Type                  | Sent when a ...                       |
| --------------------- | ------------------------------------- |
| `mandate.active`      | mandate becomes `active`              |
| `mandate.failed`      | mandate becomes `failed`              |
| `mandate.cancelled`   | mandate becomes `cancelled`           |
| `charge.submitted`    | charge becomes `submitted`            |
| `charge.confirmed`    | charge becomes `confirmed`            |
| `charge.paid_out`     | charge becomes `paid_out`             |
| `charge.failed`       | charge becomes `failed`               |
| `charge.charged_back` | charge becomes `charged_back`         |
| `charge.cancelled`    | charge becomes `cancelled`            |

No event is sent for `pending_customer_approval` or `pending_submission`.

#### `mandate.active`

```json
{
  "id": "EV1A7C3E9G5J2L8N",
  "type": "mandate.active",
  "createdAt": "2026-10-22T09:00:05.000Z",
  "resourceType": "mandate",
  "data": {
    "id": "MD7Q2V0K8B5N3XHT",
    "customerReference": "client-0042",
    "status": "active",
    "authorizationUrl": "http://localhost:4010/authorize/2y8yQ0bS3n1Q...",
    "returnUrl": "https://merchant.example/debit/return",
    "bankAccount": { "accountHolderName": "Jane Doe", "country": "NL", "ibanLast4": "0001" },
    "failureCode": null,
    "cancellationReason": null,
    "metadata": {},
    "createdAt": "2026-10-22T09:00:00.000Z",
    "updatedAt": "2026-10-22T09:00:05.000Z"
  }
}
```

#### `mandate.failed`

```json
{
  "id": "EV4D8F2H6K0M3P7R",
  "type": "mandate.failed",
  "createdAt": "2026-10-22T09:00:05.000Z",
  "resourceType": "mandate",
  "data": {
    "id": "MD2W6Y0B4D8F1H5K",
    "customerReference": "client-0043",
    "status": "failed",
    "authorizationUrl": "http://localhost:4010/authorize/9pLk2mWq7Rt4...",
    "returnUrl": "https://merchant.example/debit/return",
    "bankAccount": { "accountHolderName": "John Roe", "country": "NL", "ibanLast4": "0008" },
    "failureCode": "invalid_bank_details",
    "cancellationReason": null,
    "metadata": {},
    "createdAt": "2026-10-22T09:00:00.000Z",
    "updatedAt": "2026-10-22T09:00:05.000Z"
  }
}
```

#### `mandate.cancelled`

```json
{
  "id": "EV7G1J5M9Q3T6W0Y",
  "type": "mandate.cancelled",
  "createdAt": "2026-10-23T14:12:41.000Z",
  "resourceType": "mandate",
  "data": {
    "id": "MD7Q2V0K8B5N3XHT",
    "customerReference": "client-0042",
    "status": "cancelled",
    "authorizationUrl": "http://localhost:4010/authorize/2y8yQ0bS3n1Q...",
    "returnUrl": "https://merchant.example/debit/return",
    "bankAccount": { "accountHolderName": "Jane Doe", "country": "NL", "ibanLast4": "0001" },
    "failureCode": null,
    "cancellationReason": "cancelled_by_merchant",
    "metadata": {},
    "createdAt": "2026-10-22T09:00:00.000Z",
    "updatedAt": "2026-10-23T14:12:41.000Z"
  }
}
```

#### `charge.submitted`

```json
{
  "id": "EV9K3N7Q1T5W8Z2B",
  "type": "charge.submitted",
  "createdAt": "2026-10-22T09:00:15.000Z",
  "resourceType": "charge",
  "data": {
    "id": "CH3M9R6TQ1W4ZP0D",
    "mandateId": "MD7Q2V0K8B5N3XHT",
    "amount": 12000,
    "currency": "EUR",
    "chargeDate": "2026-10-27",
    "description": "Annual premium",
    "metadata": {},
    "status": "submitted",
    "failureCode": null,
    "createdAt": "2026-10-22T09:00:10.000Z",
    "updatedAt": "2026-10-22T09:00:15.000Z"
  }
}
```

#### `charge.confirmed`

```json
{
  "id": "EV0B4K7N2Q9T5W8X",
  "type": "charge.confirmed",
  "createdAt": "2026-10-22T09:00:20.000Z",
  "resourceType": "charge",
  "data": {
    "id": "CH3M9R6TQ1W4ZP0D",
    "mandateId": "MD7Q2V0K8B5N3XHT",
    "amount": 12000,
    "currency": "EUR",
    "chargeDate": "2026-10-27",
    "description": "Annual premium",
    "metadata": {},
    "status": "confirmed",
    "failureCode": null,
    "createdAt": "2026-10-22T09:00:10.000Z",
    "updatedAt": "2026-10-22T09:00:20.000Z"
  }
}
```

#### `charge.paid_out`

```json
{
  "id": "EV2D6G0J4M8Q1T5W",
  "type": "charge.paid_out",
  "createdAt": "2026-10-22T09:00:25.000Z",
  "resourceType": "charge",
  "data": {
    "id": "CH3M9R6TQ1W4ZP0D",
    "mandateId": "MD7Q2V0K8B5N3XHT",
    "amount": 12000,
    "currency": "EUR",
    "chargeDate": "2026-10-27",
    "description": "Annual premium",
    "metadata": {},
    "status": "paid_out",
    "failureCode": null,
    "createdAt": "2026-10-22T09:00:10.000Z",
    "updatedAt": "2026-10-22T09:00:25.000Z"
  }
}
```

#### `charge.failed`

```json
{
  "id": "EV5H9L3P7S1V4Y8C",
  "type": "charge.failed",
  "createdAt": "2026-10-22T09:00:20.000Z",
  "resourceType": "charge",
  "data": {
    "id": "CH8R2V6Z0C4F7J1M",
    "mandateId": "MD5T9X3A7E1H4L8P",
    "amount": 12000,
    "currency": "EUR",
    "chargeDate": "2026-10-27",
    "description": "Annual premium",
    "metadata": {},
    "status": "failed",
    "failureCode": "insufficient_funds",
    "createdAt": "2026-10-22T09:00:10.000Z",
    "updatedAt": "2026-10-22T09:00:20.000Z"
  }
}
```

#### `charge.charged_back`

```json
{
  "id": "EV8M2Q6T0W3Z7C1F",
  "type": "charge.charged_back",
  "createdAt": "2026-10-22T09:00:30.000Z",
  "resourceType": "charge",
  "data": {
    "id": "CH3M9R6TQ1W4ZP0D",
    "mandateId": "MD7Q2V0K8B5N3XHT",
    "amount": 12000,
    "currency": "EUR",
    "chargeDate": "2026-10-27",
    "description": "Annual premium",
    "metadata": {},
    "status": "charged_back",
    "failureCode": null,
    "createdAt": "2026-10-22T09:00:10.000Z",
    "updatedAt": "2026-10-22T09:00:30.000Z"
  }
}
```

#### `charge.cancelled`

```json
{
  "id": "EV1F5J9N3R7V0Y4B",
  "type": "charge.cancelled",
  "createdAt": "2026-10-22T09:00:12.000Z",
  "resourceType": "charge",
  "data": {
    "id": "CH6P0T4X8B2E5H9K",
    "mandateId": "MD7Q2V0K8B5N3XHT",
    "amount": 4500,
    "currency": "EUR",
    "chargeDate": "2026-10-27",
    "description": null,
    "metadata": { "invoice": "INV-2026-0117" },
    "status": "cancelled",
    "failureCode": null,
    "createdAt": "2026-10-22T09:00:10.000Z",
    "updatedAt": "2026-10-22T09:00:12.000Z"
  }
}
```

### Retrieve events

`GET /events` with optional filters `type` and `resourceId`, plus pagination parameters.

```sh
curl "http://localhost:4010/events?resourceId=CH3M9R6TQ1W4ZP0D" \
  -H "Authorization: Bearer $PAYFLOW_API_KEY"
```

`GET /events/{id}` returns one event.

### Delivery

Each event is `POST`ed as JSON to the webhook URL configured for the account (`WEBHOOK_URL`).

| Header              | Value                                          |
| ------------------- | ---------------------------------------------- |
| `Content-Type`      | `application/json`                             |
| `User-Agent`        | `PayFlow-Webhooks/1.0`                         |
| `PayFlow-Event-Id`  | The event id                                   |
| `PayFlow-Signature` | `t=<unix seconds>,v1=<hex signature>`          |

The body is the [event object](#the-event-object).

- Delivery is **at least once**: an event can be delivered more than once.
- **Order is not guaranteed**, including between events of the same resource.
- A delivery succeeds when the receiver answers `2xx` within 10 seconds. Anything else is
  retried.

### Retries

Failed deliveries are retried with backoff for up to 72 hours, 9 attempts in total:

| Attempt | Delay after the previous attempt |
| ------- | -------------------------------- |
| 2       | 1 minute                         |
| 3       | 5 minutes                        |
| 4       | 30 minutes                       |
| 5       | 2 hours                          |
| 6       | 6 hours                          |
| 7       | 12 hours                         |
| 8       | 24 hours                         |
| 9       | 24 hours                         |

After the last attempt the delivery is marked `failed`. The event stays available from
`GET /events`, and every attempt from
[`GET /events/{id}/deliveries`](#list-the-deliveries-of-an-event).

### Signatures

`PayFlow-Signature` is computed with the webhook signing secret (`WEBHOOK_SECRET`):

```
t  = unix timestamp in seconds, at sending time
v1 = hex(HMAC-SHA256(secret, t + "." + raw request body))
```

Each attempt is signed at sending time, with a new `t`.

To verify: split the header on `,` and `=`, compute `v1` over the raw body exactly as received,
compare in constant time, and check that `t` is within 5 minutes of the current time.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

const verify = (rawBody, header, secret) => {
  const { t, v1 } = Object.fromEntries(header.split(',').map((part) => part.split('=')));
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) <= 300;
  return fresh && v1?.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
};
```

The raw body is the bytes received, before any JSON parsing:

```js
import { createServer } from 'node:http';

createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  const valid = verify(rawBody, request.headers['payflow-signature'] ?? '', process.env.WEBHOOK_SECRET);
  response.writeHead(valid ? 200 : 400).end();
}).listen(3000);
```

## Webhook deliveries

A delivery is one event sent to the webhook URL, with every attempt made to send it. An event has
one delivery, plus one per [replay](#sandbox-endpoints), and two when [chaos mode](#chaos-mode)
duplicates it.

### The delivery object

```json
{
  "id": "WD5J8N1R4T7V0X3Z",
  "eventId": "EV1A7C3E9G5J2L8N",
  "url": "http://localhost:3000/webhooks/payflow",
  "status": "pending",
  "nextAttemptAt": "2026-10-22T09:06:05.000Z",
  "createdAt": "2026-10-22T09:00:05.000Z",
  "updatedAt": "2026-10-22T09:01:05.012Z",
  "attempts": [
    {
      "id": "WA2C6F9H3K7M1P4S",
      "attemptedAt": "2026-10-22T09:00:05.000Z",
      "url": "http://localhost:3000/webhooks/payflow",
      "signature": "t=1792659605,v1=1c78c63dd06b8d1d483aadbba92dc44bc31169be6935d3d0de7db45be211570d",
      "statusCode": null,
      "error": "connect ECONNREFUSED ::1:3000; connect ECONNREFUSED 127.0.0.1:3000",
      "durationMs": 4,
      "responseBody": null
    },
    {
      "id": "WA8K1N5Q9T2W6Z0D",
      "attemptedAt": "2026-10-22T09:01:05.000Z",
      "url": "http://localhost:3000/webhooks/payflow",
      "signature": "t=1792659665,v1=94e0b8f3d2a1c7e65b4f0a9d8c3e2b1f7a6d5c4b3e2f1a0b9c8d7e6f5a4b3c2d",
      "statusCode": 500,
      "error": null,
      "durationMs": 12,
      "responseBody": "{\"message\":\"Internal Server Error\"}"
    }
  ]
}
```

| Field           | Description                                                           |
| --------------- | --------------------------------------------------------------------- |
| `eventId`       | The event sent                                                        |
| `url`           | Webhook URL when the delivery was created                             |
| `status`        | `pending`, `delivered` or `failed`, see below                         |
| `nextAttemptAt` | When the next attempt is due, `null` unless `pending`                 |
| `attempts`      | Every attempt, oldest first                                           |

| Status      | Meaning                                                          |
| ----------- | ---------------------------------------------------------------- |
| `pending`   | Waiting for its first attempt, or for a retry                    |
| `delivered` | An attempt got a `2xx` answer. Final                             |
| `failed`    | All 9 attempts failed. Final                                     |

Attempt fields:

| Field          | Description                                                                 |
| -------------- | --------------------------------------------------------------------------- |
| `attemptedAt`  | When the request was sent                                                   |
| `url`          | Where it was sent                                                           |
| `signature`    | The `PayFlow-Signature` header sent                                         |
| `statusCode`   | HTTP status of the answer, `null` when none was received                    |
| `error`        | Network error or timeout when no answer was received, otherwise `null`     |
| `durationMs`   | Time until the answer, or until the error                                   |
| `responseBody` | First 2 KB of the answer body, `null` when none was received                |

### List the deliveries of an event

`GET /events/{id}/deliveries`

Newest first, plus pagination parameters. `404 resource_missing` for an unknown event.

```sh
curl http://localhost:4010/events/EV1A7C3E9G5J2L8N/deliveries \
  -H "Authorization: Bearer $PAYFLOW_API_KEY"
```

```json
{ "data": [ { "id": "WD5J8N1R4T7V0X3Z", "status": "pending", "attempts": [ ... ], "...": "..." } ], "hasMore": false }
```

## Testing

This server is the sandbox: no money moves, and outcomes depend on the IBAN used on the hosted
page.

### Sandbox IBANs

| IBAN                 | Outcome                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------- |
| `NL19PAYF0000000001` | Mandate `active`; every charge reaches `paid_out`. Any other valid IBAN behaves the same |
| `NL89PAYF0000000002` | Every charge `failed` with `insufficient_funds`                                         |
| `NL62PAYF0000000003` | First charge `failed` with `insufficient_funds`, later charges reach `paid_out`         |
| `NL35PAYF0000000004` | Charge `failed` with `account_closed`, then mandate `cancelled` (`bank_account_closed`) |
| `NL08PAYF0000000005` | Every charge `failed` with `refer_to_payer`                                             |
| `NL78PAYF0000000006` | Every charge `failed` with `failureCode: null`                                          |
| `NL51PAYF0000000007` | Charge reaches `paid_out`, then `charged_back`                                          |
| `NL24PAYF0000000008` | Mandate `failed` with `invalid_bank_details`                                            |
| `NL94PAYF0000000009` | Mandate `active`, then `cancelled` by the payer (`cancelled_by_payer`)                  |

Invalid IBANs (wrong checksum or format) are refused on the hosted page.

### Accelerated time

In the sandbox each state transition happens `SANDBOX_TRANSITION_SECONDS` (default 5) seconds
after the previous one, whatever the `chargeDate`. `chargeDate` is still validated against the
3 business day rule.

The webhook retry schedule is compressed: `WEBHOOK_RETRY_SECONDS_PER_HOUR` (default 1) seconds
per hour of the live schedule, at least 1 second between attempts. With the default, the full
72 hour window lasts about 70 seconds. Set it to `3600` for live timings.

### Chaos mode

With `WEBHOOK_CHAOS=true`, each delivery is delayed by up to 8 seconds, which reorders events,
and about one event in three is delivered twice.

### Sandbox endpoints

These require the API key.

| Endpoint                                   | Effect                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `POST /sandbox/charges/{id}/transition`    | Moves a charge to `status` now (body `{ "status": "failed", "failureCode": "insufficient_funds" }`). Must be an allowed transition. The charge then continues on its normal path |
| `POST /sandbox/mandates/{id}/cancel`       | Cancels a mandate as if the payer did it at their bank (`cancelled_by_payer`) |
| `POST /sandbox/events/{id}/replay`         | Delivers an event again to the webhook URL, as a new delivery               |

Force a transition. `failureCode` applies to `failed` only. A transition the
[charge state diagram](#charge-statuses) does not allow returns `422 invalid_transition`, with
the allowed statuses in `allowed`:

```sh
curl -X POST http://localhost:4010/sandbox/charges/CH3M9R6TQ1W4ZP0D/transition \
  -H "Authorization: Bearer $PAYFLOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "status": "failed", "failureCode": "insufficient_funds" }'
```

Cancel a mandate on the payer's side. Returns the mandate:

```sh
curl -X POST http://localhost:4010/sandbox/mandates/MD7Q2V0K8B5N3XHT/cancel \
  -H "Authorization: Bearer $PAYFLOW_API_KEY"
```

Replay an event. Returns `202` with the new delivery:

```sh
curl -X POST http://localhost:4010/sandbox/events/EV1A7C3E9G5J2L8N/replay \
  -H "Authorization: Bearer $PAYFLOW_API_KEY"
```

```json
{
  "deliveryId": "WD9B3F7K1P5T8X2C",
  "eventId": "EV1A7C3E9G5J2L8N",
  "url": "http://localhost:3000/webhooks/payflow"
}
```

### Dashboard

`GET /dashboard` lists mandates, charges and webhook deliveries. Refreshes every 3 seconds.

- Deliveries can be filtered by status: all, `failed`, `pending` or `delivered`
  (`/dashboard?deliveries=failed`).
- Each delivery opens on `/dashboard/deliveries/{id}`: the event payload, the headers and
  signature sent, and every attempt with its result, duration and response body.
- **Replay event** on that page does what `POST /sandbox/events/{id}/replay` does, and opens the
  new delivery.
