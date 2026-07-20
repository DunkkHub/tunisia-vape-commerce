# Load and concurrency testing

The repository load runner exercises commerce behavior, not the health endpoint. Run it only against an isolated staging environment with disposable customers, carts, inventory, orders, sessions, outbox events, and administrator access. Never point it at a live store.

## Scenarios and acceptance targets

| Scenario                 |                                 Full target | What is asserted                                                                                                                                                         |
| ------------------------ | ------------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Catalog browsing         |    500 requests representing browsing users | Less than 1% unexpected responses; bounded concurrency and latency percentiles are reported.                                                                             |
| Independent checkout     | 50 concurrent prepared customer/cart actors | Every request returns the configured success status and a distinct order identity for its distinct idempotency key.                                                      |
| Final-unit race          | At least 2 customers competing for one unit | Exactly one configured winner, every loser has an allowlisted stable error, and an authenticated authoritative inventory read confirms the final quantity.               |
| Repeated idempotency     |     20 concurrent copies of one request/key | Every response resolves to exactly one order identity.                                                                                                                   |
| Administrator order list |              25 authenticated list requests | Less than 1% unexpected responses and bounded latency statistics while remaining inside the endpoint's per-source security throttle.                                     |
| Worker backlog recovery  |                 One observed recovery cycle | Durable processed count advances, actionable backlog drains to its configured bound, no unapproved dead letter appears, and the latest worker heartbeat becomes healthy. |

The runner reports `passed_at_target`, `passed_reduced_scale`, `skipped`, or `failed` per scenario. Reduced or skipped execution is never reported as a full pass. Set `LOAD_REQUIRE_ALL=true` when a release/staging run must fail unless every scenario reaches its full target.

## Preparing a private fixture

Copy [fixture.example.json](../tests/load/fixture.example.json) into the ignored `work/` directory and edit the copy. The committed example keeps every scenario disabled and contains no session or CSRF secret.

```powershell
Copy-Item tests/load/fixture.example.json work/load.fixture.json
$env:LOAD_FIXTURE_PATH = (Resolve-Path work/load.fixture.json)
```

An enabled fixture must provide:

- an age-confirmed browser cookie for public catalog requests;
- 50 different active customer sessions, server-backed carts, valid checkout bodies, and unique idempotency keys for independent checkout;
- at least two different customer carts targeting the same single remaining unit, plus a `reports.read` administrator request that returns the authoritative remaining quantity;
- one separate customer/cart and one fixed idempotency key for replay testing;
- an administrator session with the permission required by the bounded order list;
- an administrator session with `reports.read` for operational metrics; and
- safe domain mutation requests that create disposable outbox work, or a pre-existing disposable backlog.

Strings consisting entirely of `${VARIABLE_NAME}` are resolved from the process environment. Missing variables fail an enabled scenario by variable name without printing the secret. Prefer environment placeholders over storing cookies or CSRF values in the fixture. The runner never includes request headers, bodies, response bodies, or order identifiers in its report.

All request paths must be same-origin absolute paths. The runner rejects embedded credentials in the base URL, cross-origin paths, unsupported methods, responses larger than its bounded parsing limit, and unresolved environment placeholders.

API throttles remain enabled during the run. The 500-user catalog and 50-customer checkout targets therefore require a controlled distributed-source staging topology (or an isolated trusted proxy test profile that preserves distinct real client addresses). Do not allowlist `429`, spoof forwarded headers through a public proxy, or weaken production throttles to manufacture a passing result; a throttle response is an unexpected response in these scenarios.

## Disposable full-target workstation orchestrator

`pnpm test:load:disposable` provisions and destroys a complete test-only topology. It requires
`NODE_ENV=test`, the exact confirmation `RUN_DISPOSABLE_FULL_TARGET_LOAD`, separate migration and
runtime database identities, a database-administrator URL, and Redis database 13. It then:

- creates a randomly named `vape_load_*` MySQL database and grants only database-scoped rights;
- deploys every migration and runs the structural seed;
- creates only disposable users, sessions, carts, products, 60 independent checkout inventory
  allocations, one final-unit allocation, and one replay allocation;
- starts one API process and the real durable-outbox worker;
- gives the disposable API and worker explicit connection-pool limits of 60 and 10 respectively,
  which must remain below the isolated MySQL server's tested connection budget;
- sends requests from real `127.0.0.0/8` loopback source addresses so Nest sees distinct client IPs
  while every existing throttle remains enabled;
- runs every scenario at scale 1 and reconciles 62 orders, reservations, inventory, notifications,
  outbox terminal states, and dead-letter count; and
- stops the child processes, flushes dedicated Redis database 13, revokes the temporary grants, and
  drops the generated database in a `finally` cleanup.

The disposable run deliberately uses the globally disabled test notification adapter, so the
worker must close each generated email or SMS notification and delivery attempt as `CANCELLED` and
its outbox event as `PROCESSED`. This proves durable backlog recovery and the disabled-adapter
terminal path; it does not prove acceptance by an external provider.

```powershell
$env:NODE_ENV = 'test'
$env:DISPOSABLE_LOAD_CONFIRM = 'RUN_DISPOSABLE_FULL_TARGET_LOAD'
$env:TEST_DATABASE_ADMIN_URL = 'mysql://test_admin:password@127.0.0.1:3306/mysql'
$env:DATABASE_MIGRATION_URL = 'mysql://migration_user:password@127.0.0.1:3306/bootstrap'
$env:DATABASE_URL = 'mysql://runtime_user:password@127.0.0.1:3306/bootstrap'
$env:TEST_LOAD_REDIS_URL = 'redis://127.0.0.1:6379/13'
pnpm test:load:disposable
```

Redis database 13 must be dedicated to this test because the guard-approved run flushes it before
and after execution. The generated MySQL database must be hosted on a disposable test server. The
runner refuses production mode, a non-generated database target, a Redis URL other than database
13, or a missing confirmation. `DISPOSABLE_LOAD_REUSE_BUILD=true` is intended only for an immediate
repeat after the same source revision already completed the orchestrator's default API/worker build.

## Commands

Run the deterministic runner tests without infrastructure:

```powershell
node --test tests/load/load-runner.test.mjs
```

Run a private fixture at reduced scale during workstation validation:

```powershell
$env:LOAD_SCALE = '0.2'
pnpm test:load
```

The result will say `passed_reduced_scale`; it is useful evidence but does not meet the documented target. Run the full staging gate with:

```powershell
Remove-Item Env:LOAD_SCALE -ErrorAction SilentlyContinue
$env:LOAD_REQUIRE_ALL = 'true'
pnpm test:load
```

The same commands work on Linux/macOS when the environment variables are exported by the shell.

## Backlog outage/recovery drill

The durable MySQL outbox is authoritative and Redis/BullMQ is transport. For an actual outage drill:

1. Use a fixture with only `workerBacklogRecovery` enabled and no `triggerRequests`.
2. Stop the worker in the isolated environment.
3. Perform safe disposable domain actions that create outbox events and confirm the metrics endpoint shows an actionable backlog.
4. Start `pnpm test:load`; while it is polling, restart the worker in a second terminal.
5. Keep `allowedDeadLetterIncrease` at `0` unless a specific failure drill intentionally expects otherwise.
6. Preserve the JSON report and reconcile the disposable orders, inventory, outbox, jobs, and notification attempts after the run.

With `triggerRequests` configured and the worker already running, the scenario measures backlog processing but is not evidence of process-outage recovery.

## Operational metrics endpoint

`GET /api/v1/admin/operations/metrics` requires an administrator session and the exact `reports.read` permission. It is no-store and returns bounded aggregate data only:

- counts for every durable outbox status;
- actionable and future-scheduled backlog counts;
- expired recovery leases;
- oldest actionable event age;
- dead-letter counts; and
- latest durable-worker heartbeat state, age, latency, and configured freshness limit.

The endpoint intentionally does not expose queue payloads, event payloads, customer data, credentials, cookies, or worker instance identifiers. It reports MySQL authority rather than claiming that a Redis queue sample is durable truth.

## Interpreting results

- A failure rate must be strictly below 1%; exactly 1% fails.
- An expected stock-conflict response is not an error only when both its HTTP status and stable error code are allowlisted by the final-unit fixture.
- The final-unit scenario is incomplete without the authoritative post-race inventory assertion.
- A skipped default run proves only that the tool starts and explains missing fixtures.
- A unit-test run proves runner logic, including oversell detection; it is not application load evidence.
- Record target host resources, database/Redis topology, API/worker replica counts, fixture scale, duration, latency percentiles, failure details, and post-run inventory/COD reconciliation with retained staging evidence.

## Latest recorded local full-target result

On 2026-07-20, `pnpm test:load:disposable` completed every full target in 96.4 seconds
against local MySQL 8.4 and Redis database 13 with one API process, one worker process, explicit
database pools of 60 and 10, and 213 distinct loopback source addresses. Normal application
throttles remained enabled.

| Scenario                 | Recorded result                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| Catalog browsing         | 500/500, concurrency 100, 0 failures; p50 856.592 ms, p95 1094.155 ms, p99 1156.995 ms      |
| Independent checkout     | 50/50, concurrency 50, 0 failures; p50 4546.099 ms, p95 7782.495 ms, p99/max 8035.067 ms    |
| Final-unit race          | 2 contenders, exactly 1 winner; loser `OUT_OF_STOCK`; authoritative remaining quantity `0`  |
| Repeated idempotency     | 20/20, 0 failures, exactly 1 order identity; p50 332.185 ms, p95 401.341 ms, p99 407.925 ms |
| Administrator order list | 25/25, 0 failures; p50 144.304 ms, p95 148.384 ms                                           |
| Worker backlog recovery  | 10 triggers, maximum backlog 2, final actionable/dead-letter counts 0, worker `HEALTHY`     |

Post-run reconciliation found 62 orders, 62 active reservations, 62 notifications, 62 cancelled
notification attempts, 62 processed notification events, 64 processed outbox events in total (the
other two were periodic reservation events), zero dead letters, and zero remaining stock for the
checkout, race, and replay allocations. This is workstation evidence, not an extrapolation or a
claim about a purchaser's target capacity; rerun the same gate in target staging before promotion.
