# Known Issues & Architectural Constraints Tracker (`KNOWN_ISSUES.md`)

**Repository**: `https://github.com/MridulS11/MyFoodAntigravity.git`  
**Current Project Stage**: Phase 1 Complete

---

## 1. Phase 1 Defect Ledger

| Issue ID | Phase | Severity | Component / Portal | Description & Root Cause | Fix Applied | Verification Test ID | Status |
| :--- | :---: | :---: | :--- | :--- | :--- | :--- | :---: |
| `BUG-001` | 1 | High | Next.js 16 Dev Server / Playwright | Next.js 16 blocked cross-origin `/_next/hmr` and JS chunk hydration when Playwright accessed `127.0.0.1:3000`, leaving client queries in loading state. | Added `allowedDevOrigins: ["127.0.0.1", "localhost"]` to `web/next.config.ts` and updated `web/playwright.config.ts` to use `http://localhost:3000`. | `TC-FE-CUST-001` | **RESOLVED** |
| `BUG-002` | 1 | Low | `PortalSwitcher` (`web/src/components/shared/PortalSwitcher.tsx`) | Route prefix check `pathname.startsWith("/restaurant")` matched `/restaurants/sunday-table`, highlighting both `Customer` and `Restaurant KDS` footer pills. | Updated route matcher to use segment-exact prefix matching (`pathname === prefix \|\| pathname.startsWith(prefix + "/")`). | `TC-FE-CUST-003` | **RESOLVED** |
| `BUG-003` | 1 | Low | Next.js 16 `cacheComponents` Prerender | Default `cacheComponents: true` in `create-next-app@16.4.5` blocked `next build` on client hooks (`usePathname`, `useParams`). | Removed experimental `cacheComponents: true` from `web/next.config.ts` so all 32 App Router pages build cleanly. | `npm run build` | **RESOLVED** |

---

## 2. Documented Architectural & Platform Constraints (SRS Section 10 & 13)

| Constraint ID | Scope | Constraint Description | Planned Mitigation |
| :--- | :--- | :--- | :--- |
| `LIM-001` | **Web-Only Delivery Partner GPS Tracking (`SRS Section 10.1`)** | Mobile web browsers (`iOS Safari`, `Android Chrome`) throttle or suspend JavaScript timers and `navigator.geolocation.watchPosition` when the browser tab is backgrounded or the device screen locks. Native background location services require the deferred Native Mobile Iteration (`SRS Section 1.2`). | 1. Request **Screen Wake Lock API** (`navigator.wakeLock`) on `/delivery/active/[id]` to keep the screen active during navigation.<br/>2. Display a clear fallback banner when desktop/browser geolocation permission is denied.<br/>3. Buffer offline coordinates and reconcile state on WebSocket reconnect (Phase 5). |
| `LIM-002` | **Browser Web Push Support (`FR-090`)** | Browser push notifications require explicit user permission grant (`Notification.requestPermission()`) and HTTPS/localhost context; iOS Safari requires Home Screen installation (PWA manifest) for background Web Push. | Combine in-app real-time WebSocket toast/audio alerts with optional Web Push subscription and transactional SMS/Email fallbacks (Phase 6). |
| `LIM-003` | **Mock Image Elements (`@next/next/no-img-element`)** | ESLint reports 8 non-blocking warnings for standard `<img>` tags used on food photography cards to simplify Phase 1 local/CDN preview. | Replace with `next/image` configured for CloudFront/S3 `remotePatterns` during Phase 6/7 optimization. |
