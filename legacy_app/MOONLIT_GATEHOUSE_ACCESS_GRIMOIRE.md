# The Moonlit Gatehouse

## TechScout access-management and `.env` operator grimoire

This guide explains exactly how TechScout authorization works, what every
Access Management checkbox grants, which `.env` setting provides each
deployment-level bootstrap, which key belongs in each protected prompt, and
what an administrator should enter when adding a person.

It describes the active production-shaped application in `legacy_app/`. Older
top-level applications and old Default/Broadcast profile-routing documents are
not the authority for access control.

---

## 1. The three gates

TechScout combines three independent authorization sources:

1. **A runtime grant for a signed browser identity**
   - Created from **Settings → Access Management → Add a person**.
   - Stored in `NEWSSCRAPPER_RUNTIME_DIR/access_control.json`.
   - Takes effect on the backend immediately; no backend restart is required.
   - The recipient should reload TechScout so the frontend fetches its new
     capabilities and reveals the appropriate navigation.

2. **A deployment bootstrap for an exact client IP address**
   - Configured with `*_ALLOWED_IPS` variables in `legacy_app/.env`.
   - Intended for the first administrator, controlled office/VPN networks, and
     lockout recovery.
   - Requires a backend restart after `.env` is changed.

3. **A temporary privileged session created from a role key**
   - Keys come from `DIRECTOR_KEY`, `GATEKEEPER_KEY`, `ANALYTICS_KEY`, or
     `INTERNAL_EDITOR_KEY`.
   - A successful role unlock creates an HttpOnly, SameSite=Strict cookie.
   - The session lasts **six hours**, lives only in the current backend process,
     and is revoked by logout or a backend restart.

The effective permission set is the **union** of all three gates:

```text
runtime identity grants
  + IP bootstrap grants
  + temporary role-session grants
  = effective capabilities
```

This union matters when removing access. Unchecking a runtime permission does
not remove the same permission if the person still receives it from an IP
allowlist or an active role session.

### What Access Management does not do

- It does **not** edit `.env`.
- It does **not** store a person's raw browser cookie.
- The optional **Trusted network addresses** field is recognition/audit
  metadata. It does not itself grant a capability.
- It does **not** restart the backend.
- It does **not** make a public article private or a private draft public.

---

## 2. Where the real `.env` lives

The active file is:

```text
legacy_app/.env
```

It sits beside `legacy_app/main.py`. Create it from `.env.example` and never
commit it:

```powershell
Copy-Item .env.example .env
```

Use one `KEY=value` setting per line. Do not add spaces around `=`. IP lists are
comma-separated exact addresses, for example:

```dotenv
ACCESS_MANAGEMENT_ALLOWED_IPS=10.24.8.17,10.24.8.18
```

These allowlists do not accept CIDR ranges such as `10.24.8.0/24`. Add each
approved address explicitly. IPv4 and IPv6 addresses are normalized before
comparison.

After changing `.env`, restart the single Uvicorn process. Runtime checkbox
changes do not require that restart.

---

## 3. First administrator bootstrap

In production, Access Management fails closed unless an administrator is
explicitly allowed. `DIRECTOR_KEY` deliberately does **not** grant
`access.manage`, so it cannot be used as a backdoor into team access.

### Direct server or LAN deployment

Put the first administrator's exact client address in:

```dotenv
NEWSSCRAPPER_ENV=production
ACCESS_MANAGEMENT_ALLOWED_IPS=10.24.8.17
TRUSTED_PROXY_IPS=127.0.0.1,::1
```

Restart the backend, open TechScout from `10.24.8.17`, then use:

```text
Settings → Access Management
```

### Deployment behind a reverse proxy

`X-Forwarded-For` is accepted only when the immediate network peer is listed in
`TRUSTED_PROXY_IPS`. List only proxies you operate:

```dotenv
ACCESS_MANAGEMENT_ALLOWED_IPS=10.24.8.17
TRUSTED_PROXY_IPS=127.0.0.1,::1,10.24.1.10
```

Do not put every employee address in `TRUSTED_PROXY_IPS`. That variable says
which machines are trusted to report client addresses; it grants no workspace
permission by itself.

### Recommended post-bootstrap step

Once the first administrator can open Access Management:

1. Obtain the administrator's own browser principal using section 4.
2. Add that principal in Access Management.
3. Grant it **Manage team access**.
4. Save and reload TechScout.
5. Keep the IP bootstrap as documented emergency recovery, or remove it from
   `.env` after confirming the identity grant works and restarting the backend.

---

## 4. What to paste into “Viewer identity token”

Despite the field's historical label, the Access Management API expects the
person's stable **principal**, not their raw `techscout_viewer` cookie.

On the person's own TechScout browser, open the same-origin route:

```text
https://YOUR-TECHSCOUT-HOST/viewer/profile
```

For a local Vite development session:

```text
http://127.0.0.1:5173/viewer/profile
```

The response contains:

```json
{
  "status": "success",
  "display_name": "Example Person",
  "email": "",
  "principal": "64-character-private-principal"
}
```

Copy only the value of `principal` and paste it into **Viewer identity token**.

Do not copy:

- the `techscout_viewer` cookie;
- an IP address;
- the person's display name;
- `NEWSSCRAPPER_VIEWER_COOKIE_SECRET`;
- an IP hash from Analytics.

The principal is a one-way derived browser identity. It normally stays stable
for that browser for one year. Clearing the TechScout identity cookie or
changing `NEWSSCRAPPER_VIEWER_COOKIE_SECRET` creates a new identity, so a new
principal must then be granted.

### Adding a person, field by field

1. Click **Add a person**.
2. In **Viewer identity token**, paste the `principal` value described above.
3. In **Name shown in this workspace**, enter a readable team name. This is for
   the access list and audit display; it is not used for authentication.
4. In **Trusted network addresses**, optionally enter exact office or VPN
   addresses separated by commas. These are descriptive metadata only.
5. Select the minimum required checkboxes.
6. Click **Save access**.
7. Ask the recipient to reload TechScout.

The backend writes the grant atomically and records capability changes in:

```text
NEWSSCRAPPER_RUNTIME_DIR/access_control.json
NEWSSCRAPPER_RUNTIME_DIR/access_control_audit.json
```

Do not commit those runtime files and do not hand-edit them while TechScout is
running.

---

## 5. Every Access Management checkbox

Checkboxes are exact capabilities. They are not automatically hierarchical: a
“control” permission does not always include the corresponding “view”
permission. Use the recommended pairs below.

### Editorial review

#### Open the review queue — `review.news.view`

Grants:

- visibility of **Settings → Review Center**;
- read access to shared news signals awaiting editorial review.

Does not grant:

- submitting a signal;
- approving or rejecting it;
- changing regions.

Deployment bootstrap:

```dotenv
REVIEW_NEWS_ALLOWED_IPS=10.24.8.21
```

That bootstrap grants both `review.news.view` and `review.news.submit`.

#### Send signals for review — `review.news.submit`

Grants:

- moving briefing signals into the shared review queue;
- importing signals from Briefing Archive into review;
- removing pending review items.

Recommended companion: `review.news.view`, so the person can see the Review
Center navigation and the queue they are modifying.

Deployment bootstrap: `REVIEW_NEWS_ALLOWED_IPS`.

#### Approve or reject signals — `review.news.approve`

Grants:

- final approval decisions;
- access to approved workflow data;
- removal of approved workflow items.

Recommended bundle:

```text
review.news.view
review.news.submit
review.news.approve
approved.view
```

The broad `OPERATIONS_ALLOWED_IPS` bootstrap includes this permission.

#### Read the approved archive — `approved.view`

Grants read-only access to **Settings → Approved Briefing** and approved
workflow records.

Deployment bootstrap:

```dotenv
APPROVED_BRIEFING_ALLOWED_IPS=10.24.8.21
```

---

### Samsung publishing

#### Review colleague submissions — `review.contributions.view`

Grants:

- visibility of the contribution side of **Review Center**;
- reading submitted stories, leadership messages, and announcements.

It does not grant authoring or publishing.

Temporary key equivalent: the `editor` role created with
`INTERNAL_EDITOR_KEY` includes both contribution review and publish access.

#### Publish and remove content — `review.contributions.publish`

Grants:

- publishing submitted internal content;
- requesting changes or rejecting a submission;
- archiving and restoring published Samsung Internal content;
- the Samsung Internal announcement-management controls.

It does not grant permanent deletion. Permanent internal-content deletion is
reserved for `access.manage`.

Recommended companion: `review.contributions.view`.

Temporary key equivalent: `INTERNAL_EDITOR_KEY` through the editor unlock.

#### Create internal content — `contributions.create`

Grants:

- the contribution authoring workspace;
- creating or importing drafts;
- updating, submitting, withdrawing, or deleting the person's own records;
- cover upload and owner notifications.

It does not let the contributor inspect or publish other people's submissions.

Deployment bootstrap:

```dotenv
CONTRIBUTIONS_ALLOWED_IPS=10.24.8.31,10.24.8.32
```

Unlike the optional Access Management metadata field,
`CONTRIBUTIONS_ALLOWED_IPS` is an active authoring gate.

---

### Content operations

#### View the source library — `sources.view`

Grants read-only access to **Settings → Source Control** and the authoritative
unified source catalog.

Deployment bootstrap:

```dotenv
SOURCE_CONTROL_ALLOWED_IPS=10.24.8.41
```

That bootstrap grants both source view and source management.

#### Manage the source library — `sources.manage`

Grants adding, editing, enabling, pausing, and deleting monitored sources in
the authoritative `sites.json` catalog.

Recommended companion: `sources.view`. Without it, a manager cannot reliably
load the catalog before editing it.

Deployment bootstrap: `SOURCE_CONTROL_ALLOWED_IPS`.

#### View automation schedules — `scheduler.view`

Grants read access to **Settings → Scheduler**, scheduler status, and the
detailed status returned to that screen.

Deployment bootstrap:

```dotenv
SCHEDULER_ALLOWED_IPS=10.24.8.42
```

That bootstrap grants both scheduler view and control.

#### Control scheduled runs — `scheduler.control`

Grants queuing an immediate shared scheduler run. Scheduler control is rate
limited and does not create a second scheduler.

Recommended companion: `scheduler.view`.

Deployment bootstrap: `SCHEDULER_ALLOWED_IPS`.

#### Start a news scan — `crawl.run`

Grants launching an on-demand manual collection scan from the Scan workspace.
Manual crawl starts are rate limited.

Deployment bootstrap:

```dotenv
CRAWL_ALLOWED_IPS=10.24.8.43
```

---

### Governance and insights

#### Review shared feedback — `gatekeeper.review`

Grants:

- **Settings → Gatekeeper Review**;
- inspection and restoration of Gatekeeper-rejected records;
- the IP-gated article kill switch used for briefing-wide removal;
- restoring an article to the shared briefing.

It does not by itself grant model training or region correction.

Deployment bootstrap:

```dotenv
GATEKEEPER_ALLOWED_IPS=10.24.8.51
```

That bootstrap grants `gatekeeper.review`, `model.train`, and
`region.correct` together.

Temporary key: `GATEKEEPER_KEY` for the Gatekeeper review password flow. A
network or runtime capability may still be required before the route is shown.

#### View leadership analytics — `analytics.view`

Grants **Settings → Analytics**, aggregate engagement, feedback, briefing, and
recommendation-quality metrics.

Deployment bootstrap:

```dotenv
ANALYTICS_ALLOWED_IPS=10.24.8.52
```

Temporary role key: `ANALYTICS_KEY` through the capability-session unlock API.
The backend capability, not the mere presence of a password field, is the
authoritative authorization check.

#### Correct content regions — `region.correct`

Grants saving a Local/Global correction and its learned keywords for future
scans.

Deployment bootstrap: `GATEKEEPER_ALLOWED_IPS`.

#### Start model training — `model.train`

Grants starting an approved training cycle. This is a high-impact, rate-limited
operation and should normally be paired with `gatekeeper.review`.

Deployment bootstrap: `GATEKEEPER_ALLOWED_IPS`.

#### View detailed system health — `system.status.detail`

Grants sensitive diagnostics in `/status`, including pipeline preflight detail
and runtime profile paths. Ordinary users still receive the public status
summary without these details.

Deployment bootstrap:

```dotenv
SYSTEM_STATUS_ALLOWED_IPS=10.24.8.53
```

#### Manage team access — `access.manage`

Grants:

- **Settings → Access Management**;
- listing and updating runtime principals;
- reading the access audit trail;
- permanently deleting an internal-content record after it has entered an
  appropriate removable state.

This is the highest-trust permission. Grant it to very few people.

Deployment bootstrap:

```dotenv
ACCESS_MANAGEMENT_ALLOWED_IPS=10.24.8.17
```

`DIRECTOR_KEY` and `OPERATIONS_ALLOWED_IPS` intentionally do not include
`access.manage`.

---

## 6. `.env` allowlist map

| `.env` variable | Capabilities granted to matching exact IPs |
|---|---|
| `CONTRIBUTIONS_ALLOWED_IPS` | `contributions.create` |
| `ANALYTICS_ALLOWED_IPS` | `analytics.view` |
| `GATEKEEPER_ALLOWED_IPS` | `gatekeeper.review`, `model.train`, `region.correct` |
| `SYSTEM_STATUS_ALLOWED_IPS` | `system.status.detail` |
| `REVIEW_NEWS_ALLOWED_IPS` | `review.news.view`, `review.news.submit` |
| `APPROVED_BRIEFING_ALLOWED_IPS` | `approved.view` |
| `SOURCE_CONTROL_ALLOWED_IPS` | `sources.view`, `sources.manage` |
| `SCHEDULER_ALLOWED_IPS` | `scheduler.view`, `scheduler.control` |
| `CRAWL_ALLOWED_IPS` | `crawl.run` |
| `ACCESS_MANAGEMENT_ALLOWED_IPS` | `access.manage` |
| `OPERATIONS_ALLOWED_IPS` | News view/submit/approve, contribution review/publish, approved archive, source view/manage, scheduler view/control, crawl, and detailed system status |

`OPERATIONS_ALLOWED_IPS` does **not** grant contribution authoring,
Gatekeeper/model/region controls, analytics, or Access Management.

### Variables that look related but do not grant access

| Variable | Actual purpose |
|---|---|
| `TRUSTED_PROXY_IPS` | Trusts a proxy to report the real client address; grants no capability |
| `TEAM_IP_MAP` | Gives an IP a readable analytics/display name; grants no capability |
| `PROFILE_SETTINGS_ALLOWED_IPS` | Retained for legacy rollback; not part of the active capability model |
| `BROADCAST_SPECIAL_IPS` | Retained legacy profile-routing input; unified serving ignores it |

---

## 7. Key map: what value belongs in which prompt

Use distinct, long random values for every production key. Production refuses
approval, analytics, and Gatekeeper keys shorter than six characters; 32 or
more randomly generated characters is the safer operator standard.

Never paste a real key into this guide, `.env.example`, source code, a support
ticket, or a Git commit.

### `DIRECTOR_KEY`

Place in `.env`:

```dotenv
DIRECTOR_KEY=replace-with-a-long-random-director-secret
```

Temporary director role scope:

- every defined capability except `access.manage`;
- intended for broad operational approval, not team-access administration.

Important current behavior: protected endpoints still enforce capabilities.
A legacy approval confirmation field is not, by itself, a substitute for an
effective `review.news.approve` capability. The supported role-session exchange
is `POST /access-control/session/unlock` with role `director`.

### `GATEKEEPER_KEY`

Place in `.env`:

```dotenv
GATEKEEPER_KEY=replace-with-a-long-random-gatekeeper-secret
```

Enter this value in the **Gatekeeper Review** password prompt.

Temporary gatekeeper role scope:

```text
gatekeeper.review
model.train
region.correct
```

It is also the first fallback for `INTERNAL_EDITOR_KEY` when an explicit editor
key is absent. Set an explicit editor key in production so the two roles are not
silently coupled.

### `ANALYTICS_KEY`

Place in `.env`:

```dotenv
ANALYTICS_KEY=replace-with-a-long-random-analytics-secret
```

Temporary analytics role scope:

```text
analytics.view
```

The authoritative Analytics check is the capability. Use a runtime grant, an
analytics IP bootstrap, or exchange this key for the `analytics` role session.

### `INTERNAL_EDITOR_KEY`

Place in `.env`:

```dotenv
INTERNAL_EDITOR_KEY=replace-with-a-long-random-editor-secret
```

Enter this value in **Review Center → Contributions → Editor access required**.

Temporary editor role scope:

```text
review.contributions.view
review.contributions.publish
```

Fallback chain when this variable is missing:

```text
INTERNAL_EDITOR_KEY
  → GATEKEEPER_KEY
  → DIRECTOR_KEY
  → development-only 1357
```

Production has no `1357` fallback. Always set the explicit editor key.

### Role unlock request contract

The shared session endpoint accepts:

```http
POST /access-control/session/unlock
Content-Type: application/json

{
  "role": "director | gatekeeper | analytics | editor",
  "key": "the matching env value"
}
```

It is rate limited to 10 attempts per client address per 15 minutes. A
successful response creates the six-hour privileged session cookie; it does
not modify `.env` or `access_control.json`.

---

## 8. Recommended permission bundles

### Contributor

```text
contributions.create
```

Can author and manage only their own internal drafts and submissions.

### Contribution editor/publisher

```text
review.contributions.view
review.contributions.publish
```

Can review, publish, request changes, reject, archive, and restore. Add
`contributions.create` only if the editor should also author content.

### News reviewer

```text
review.news.view
review.news.submit
```

Can build and maintain the pending editorial queue without final approval.

### News approver

```text
review.news.view
review.news.submit
review.news.approve
approved.view
```

Can operate the complete shared news-review lifecycle.

### Source librarian

```text
sources.view
sources.manage
```

Can inspect and change the authoritative source catalog.

### Scheduler operator

```text
scheduler.view
scheduler.control
```

Add `crawl.run` only if the person also needs manual Scan launches.

### Gatekeeper supervisor

```text
gatekeeper.review
region.correct
model.train
```

Can review rejected intelligence, correct regions, and initiate approved model
training.

### Analytics observer

```text
analytics.view
```

Read-only leadership and recommendation analytics.

### Access administrator

```text
access.manage
```

Add operational capabilities only when this person also performs those jobs.
`access.manage` should not be used as a generic “superuser” checkbox.

### Broad operations administrator

For a human administrator, prefer selecting the exact runtime capabilities in
Access Management. `OPERATIONS_ALLOWED_IPS` is a deployment bootstrap for a
controlled machine/network, not a substitute for least-privilege identity
grants.

---

## 9. Removing and changing access

1. Open **Settings → Access Management**.
2. Select the person.
3. Uncheck the unwanted capabilities.
4. Click **Save access**.
5. Ask the person to reload TechScout.

If access remains, check all three gates:

- Is their IP still in a matching `*_ALLOWED_IPS` variable?
- Do they still have an active six-hour role session?
- Does another selected runtime capability independently expose the same
  workspace?

Logging out of the privileged session or restarting the backend clears the
in-memory role session. Removing an IP bootstrap requires editing `.env` and
restarting. Runtime checkbox removal is immediate on the backend.

The current UI keeps a principal record even when all checkboxes are removed.
That empty record grants nothing and preserves an auditable identity history.

---

## 10. Lockout recovery

If no administrator can open Access Management:

1. Identify the exact client address of a controlled administrator machine.
2. Add it to `ACCESS_MANAGEMENT_ALLOWED_IPS` in `legacy_app/.env`.
3. If a reverse proxy is used, verify that only the proxy's address is in
   `TRUSTED_PROXY_IPS` and that it reports the real client address.
4. Restart the single backend process.
5. Open TechScout from the approved address.
6. Repair the administrator's principal grant.
7. Reload the browser and confirm `/access-control/capabilities` contains
   `access.manage`.

Do not recover by placing the whole LAN into an allowlist, trusting arbitrary
forwarded headers, weakening key lengths, or editing runtime JSON while the
backend is active.

---

## 11. Verification routes

These same-origin JSON routes are useful for operators:

### Current browser identity

```text
GET /viewer/profile
```

Copy the `principal` value when adding that browser in Access Management.

### Current effective permissions

```text
GET /access-control/capabilities
```

Example:

```json
{
  "status": "success",
  "principal": "...",
  "ip": "10.24.8.17",
  "capabilities": ["access.manage", "scheduler.view"]
}
```

This is the authoritative answer to “what can this browser do right now?”

### Access records and audit

```text
GET /access-control/principals
GET /access-control/audit?limit=200
```

Both require `access.manage`.

---

## 12. Production safety rules

- Keep `.env`, runtime JSON, audit JSON, viewer activity, and secrets out of
  GitHub.
- Use separate random secrets for director, Gatekeeper, analytics, editor,
  viewer-cookie signing, and IP hashing.
- Never change `NEWSSCRAPPER_VIEWER_COOKIE_SECRET` casually. Doing so gives
  every browser a different principal and invalidates existing identity grants.
- Keep `NEWSSCRAPPER_VIEWER_COOKIE_SECURE=auto` only for the current HTTP LAN
  pilot. Use `true` after HTTPS is mandatory.
- Keep `NEWSSCRAPPER_ENV=production` in production.
- Run exactly one Uvicorn worker while capability sessions and mutable JSON are
  process-local.
- Prefer signed-browser runtime grants over large IP allowlists.
- Treat `access.manage`, `model.train`, `sources.manage`, `scheduler.control`,
  and `review.contributions.publish` as high-trust capabilities.
- Review **Recent access changes** after every administrative change.
- Removing a visible button is not security. Backend capabilities are the
  authoritative enforcement boundary.

---

## 13. Minimal secure production example

Replace every sample address and secret before use:

```dotenv
NEWSSCRAPPER_ENV=production

DIRECTOR_KEY=replace-with-a-unique-long-random-director-key
ANALYTICS_KEY=replace-with-a-unique-long-random-analytics-key
GATEKEEPER_KEY=replace-with-a-unique-long-random-gatekeeper-key
INTERNAL_EDITOR_KEY=replace-with-a-unique-long-random-editor-key

NEWSSCRAPPER_IP_HASH_SECRET=replace-with-a-generated-64-character-secret
NEWSSCRAPPER_VIEWER_COOKIE_SECRET=replace-with-a-different-generated-64-character-secret
NEWSSCRAPPER_VIEWER_COOKIE_SECURE=true

ACCESS_MANAGEMENT_ALLOWED_IPS=10.24.8.17
CONTRIBUTIONS_ALLOWED_IPS=
ANALYTICS_ALLOWED_IPS=
GATEKEEPER_ALLOWED_IPS=
SYSTEM_STATUS_ALLOWED_IPS=
OPERATIONS_ALLOWED_IPS=
REVIEW_NEWS_ALLOWED_IPS=
APPROVED_BRIEFING_ALLOWED_IPS=
SOURCE_CONTROL_ALLOWED_IPS=
SCHEDULER_ALLOWED_IPS=
CRAWL_ALLOWED_IPS=

TRUSTED_PROXY_IPS=127.0.0.1,::1,10.24.1.10
TEAM_IP_MAP=

WEB_CONCURRENCY=1
UVICORN_WORKERS=1
```

Bootstrap the first access administrator, convert day-to-day permissions to
signed-browser runtime grants, then keep the `.env` allowlists as narrow as the
deployment and recovery plan allow.
