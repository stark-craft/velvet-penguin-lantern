# Sampark SSO Integration — Handoff

## Current State

**Standalone auth/access mechanism:**
- Original app has **no username/password login screen**. Authentication is **capability-based** (`legacy_app/news_scrapper/access_control/router.py:46` `POST /access-control/session/unlock {role, key}` → `service.create_privileged_session` → `HttpOnly` privileged session cookie). Roles: `director` (all minus access.manage), `gatekeeper` (gatekeeper.review), `analytics` (analytics.view), `editor` (review.contributions) (`ROLE_CAPABILITIES:26`). Keys from env `DIRECTOR_KEY`, `GATEKEEPER_KEY`, `ANALYTICS_KEY`, `INTERNAL_EDITOR_KEY` (`_role_key:17`). Capability discovery `GET /access-control/capabilities` (`35`) returns sorted capabilities for current principal+IP. Logout `POST /access-control/session/logout` (`69`) revokes. Rate limited `10/15m` (`52`).
- **IP allowlisting** exists for some capabilities via `access_control/service.py` principals (`list_principals`, `update_principal` with `known_ips`, `grant_by_ip`). Used for scheduler, sources, etc. Preserved where required, not as primary login.
- **Viewer profile** `GET/POST /viewer/profile` (`application.py:6681`) stores `display_name/email` keyed by **private viewer_key** (browser cookie `techscout_viewer` `identity.py:14` HMAC) with legacy IP fallback and `PRIVATE_VIEWER_CLAIMS` migration (`application.py:6681` `claimed_elsewhere`).

**techscout_viewer private viewer identity:**
- `legacy_app/news_scrapper/recommendation/identity.py:14` `COOKIE_NAME techscout_viewer` `HttpOnly Lax MaxAge 365d Secure:auto` → `viewer_key = hmac(secret, token)` `47` → `viewers/{hmac}.json` (`preferences.py:127`) holds `preferences, events, served, feed_snapshots, reaction_events`. Used for For You ranking (`router.py:556` `_resolve`), saved (`2966` `claim_legacy_private_bucket`), hidden now private (`2978` migrated), briefings, following.
- `SamparkForYou.jsx:6` `getForYou`, `getViewerPreferences`, `getFollowingThreads` all use this cookie via `fetch` same-origin.
- **IP fallback/legacy:** `get_viewer_key(ip)=sha256(IP_HASH_SECRET:ip)` `application.py:2800` only for migration via `PRIVATE_VIEWER_CLAIMS.json` first-browser-at-IP claims legacy IP store. `get_private_viewer_key` prefers cookie.

**Current profile/settings state:**
- `SamparkSettingsModal.jsx` real: `updateViewerProfile` (`api.js:363`), `pauseViewerPersonalization` (`278`), `unlockCapabilitySession/logoutCapabilitySession` (`436`), capabilities display, workspace links, `SAMPARK_SETTINGS_KEY` local `emailNotifications/pushNotifications/dailyDigest` (frontend-only, `localStorage`), `compactView`, `saveSearchHistory`, `personalizedFeed` (pause). No fake backend for digest.

## Final Sampark Goal

```
Samsung PC (already authed to Sampark portal)
  → Sampark SSO (trusted)
  → TechScout (under /sampark, same FastAPI host main.py:115 serve sampark/index.html)
  → automatically authenticated, no second TechScout role-key screen
  → Sampark organizational identity → stable TechScout principal
  → same viewer's preferences/events/saves/hidden/profile (migrated from anonymous cookie)
```

Sampark SSO is **trusted employee identity** (unique organizational subject). TechScout must not show second login when hosted under Sampark.

## Required SSO Inputs — TBD (pending Sampark contract — do not invent)

- Stable **immutable organizational subject ID** (e.g., employee ID / subject) — field name TBD
- **Display name** (TBD claim)
- **Email** if available (TBD)
- **Organizational roles/groups** if Sampark exposes them (TBD)
- **Authentication / session expiry** / idle timeout (TBD)
- **Logout / session lifecycle** (single sign-out propagation) (TBD)
- **Trusted verification mechanism** — exact delivery mechanism TBD (e.g., header, signed token, trusted reverse proxy, OIDC — examples, not decided)
- **Audience / issuer validation** (TBD)

Mark all exact field names, token formats, header names **TBD pending Sampark SSO documentation**. Do not hardcode `X-User-ID` from open internet.

## Integration Boundary

**Frontend to replace/extend:**
- `src/sampark/auth/SamparkAuthContext.jsx` — current provider `unlockCapabilitySession`/`logoutCapabilitySession`/`getAccessCapabilities`/`getViewerProfile` → future `SamparkSSOProvider` (verify trusted identity, no role key)
- `src/sampark/SamparkLogin.jsx` — standalone role-key card → hidden when `ssoMode:true` (no second login)
- `src/sampark/SamparkApp.jsx` header user menu + `/login` route — keep For You/All News etc., just identity source changes
- `src/sampark/SamparkSettingsModal.jsx` Login & access section — hide role-key when SSO, show Sampark principal

**Backend to replace/extend:**
- `news_scrapper/access_control/service.py` `resolve_principal/effective_capabilities` → accept Sampark trusted principal (verified server-side)
- `news_scrapper/recommendation/identity.py` `bind_viewer_request/resolve_viewer` → optionally bind `viewer_key` from SSO principal (with migration from cookie)
- `news_scrapper/application.py` `read_viewer_profile/update_viewer_profile` already private-key aware, extend to SSO principal

Do not touch scoring/crawler/BART/ForYouScreen.

## Identity Migration

Today: `browser cookie → private viewer_key → preferences/events/saves/hidden/profile`

Future: `Sampark SSO subject → stable TechScout principal → same stores`

**Migration path (preserve personalization):** When a trusted Sampark identity assertion is first seen for a browser that already has anonymous `techscout_viewer` state, **one-time anonymous-viewer-to-authenticated-principal migration** (mechanism TBD, similar in spirit to existing `claim_legacy_private_bucket` pattern for IP migration):

```
verified immutable organizational subject (exact claim TBD)
  → server-side trusted principal mapping (implementation TBD)
  → if authenticated principal has no state but anonymous viewer_key has:
      merge anonymous state → authenticated principal (events, preferences, saved, hidden)
      keep anonymous viewer_key as alias for rollback where appropriate
```

If Sampark provides an immutable subject, do not use email as key. If the authenticated principal already has state, keep it (do not overwrite). Migration store/mechanism TBD.

Anonymous → SSO migration is optional; if user never had anonymous state, start fresh.

## Security Requirements

- **Never trust** identity from arbitrary frontend JavaScript (`localStorage`, `?user=`, `X-User-ID` from internet). SSO identity must be **verified server-side** via a trusted Sampark identity assertion — exact delivery mechanism TBD (e.g., trusted reverse proxy/gateway that sets a validated header — example, not decided).
- No raw organizational IDs in logs unnecessarily; log `viewer_key` hash.
- No SSO tokens in `localStorage`; keep `HttpOnly` session/SSO cookie.
- Preserve `SameSite=Lax` for same-origin `/`+`/sampark` (`main.py:115` same FastAPI host). Only use `SameSite=None; Secure` if cross-site iframe is **proven** required — current evidence is same-origin (`main.py:115` serve sampark/index.html) + Vite proxy, so Lax is correct.
- Authorization remains server-side (`service.require_capability` `router.py:77`).

## Cutover Checklist (for future engineer with real SSO docs)

- [ ] Obtain Sampark SSO contract: subject claim name, issuer, audience, trusted verification mechanism (exact delivery — e.g., header, signed token, gateway — example, not decided), logout flow, session TTL
- [ ] Decide deployment: same-origin (`main.py` serve) vs reverse-proxy under Sampark domain — confirm cookie `Domain`/`SameSite` with actual topology
- [ ] Implement `SamparkSSOProvider` in `SamparkAuthContext.jsx` that validates trusted Sampark identity assertion server-side (mechanism TBD) and exposes `{ssoMode:true, samparkPrincipal, displayName, email}` (exact claims TBD)
- [ ] Backend: add trusted Sampark auth middleware to set `request.state.sampark_principal` after server-side verification; extend `access_control/service.py` to map Sampark groups → capabilities (TBD mapping)
- [ ] Backend: extend `identity.py` to optionally derive viewer identity from trusted Sampark principal via server-side mapping (implementation TBD) and perform anonymous-viewer-to-authenticated-principal migration as above
- [ ] Hide standalone `SamparkLogin.jsx` role-key UI when `ssoMode` (keep for dev fallback behind `env SAMPARK_SSO_ENABLED`)
- [ ] Update `SamparkSettingsModal` to show Sampark principal, hide role-key, keep profile edit (display_name may become read-only if SSO provides it)
- [ ] Test: Browser A same IP, Browser B same IP still isolated via SSO subject, not IP; returning SSO user retains preferences
- [ ] Test: Logout via Sampark portal propagates to TechScout (clear privileged session, not personalization)
- [ ] Update this doc with exact field names after contract

## What Must Be Removed/Replaced At Cutover

- **Standalone role-key login UI** `SamparkLogin.jsx` (role select + key input, `unlockCapabilitySession` call) — replace with SSO auto-auth; keep behind dev flag for local testing, not shown under Sampark.
- **Header `Access / Switch role` / `Sign out (clear role session)` that calls `logoutCapabilitySession`** — replace with Sampark logout (portal sign-out) when `ssoMode`.
- **Direct `DIRECTOR_KEY`/`GATEKEEPER_KEY` env-based `unlockCapabilitySession` flow** for Sampark users — keep for non-Sampark local dev only.
- **IP-based capability grants** where they were only fallback for standalone — keep only where explicitly required (scheduler, etc.).
- Do **not** remove `techscout_viewer` cookie; it remains for anonymous personalization until migrated to SSO principal, then becomes alias.

Keep: `For You`, `All News`, `Research`, `Samsung News` tabs; `techscout_viewer` personalization; `SamparkSettingsModal` profile/preferences (except Login section).
