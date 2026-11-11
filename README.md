# ADOC Program Services Staff Portal

A small internal website for Program Services staff. Each person signs in with their own account and sees only the tools for their role. New shortcuts are added by the Program Services supervisor.

| Role | Sees |
|---|---|
| Supervisor | Everything, plus **Manage Team** (add staff, reset passwords, turn accounts off) and the Shortcut Ideas inbox |
| Social Service Caseworker | **Certificates of Completion** (paste a class roster, print one certificate per person), Shortcut Ideas |
| Chaplain | **Chapel & Classroom Calendar** (placeholder for now), Shortcut Ideas |

## Run it on your computer

Requires Node 22.13 or newer. There is nothing to install (no npm packages).

```
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='pick-a-temporary-one' ADMIN_NAME='Your Name' node server.js
```

Open http://localhost:3000, sign in, and you will be asked to choose a real password. The temporary values are only used when the database has no users yet. Data is stored in `./data/portal.db` (ignored by git).

Run the tests with `node --test`.

## Deploy to Render

1. Push this repository to GitHub.
2. In Render choose **New > Blueprint**, pick the repository and the `main` branch. Render reads `render.yaml` and proposes a web service named `adoc-staff-portal` with a 1 GB persistent disk.
3. When prompted, enter `ADMIN_EMAIL`, `ADMIN_NAME` and `ADMIN_PASSWORD` (a one-time temporary password), then apply.
4. After the first deploy, open the site, sign in, and change the password. Then **delete `ADMIN_PASSWORD`** from the Render environment settings.

The accounts database is a file on the persistent disk mounted at `/var/data`. Persistent disks need a paid web service plan (the blueprint uses `starter`). Without the disk, accounts would vanish on every deploy.

Each push to the connected branch redeploys automatically.

## Adding a new shortcut

1. Add an entry to `lib/tools.js` (id, name, description, link, and which roles may use it).
2. Create `public/tools/<id>/index.html` plus a `.js` file next to it. Copy `public/tools/chapel-calendar/` as a starting point.
3. Call `Portal.start({ roles: [...] })` at the top of your script. It loads the user, draws the header, and enforces the role in the browser.

The server also blocks anyone without a matching role from every file under `/tools/<id>/`, and from `/admin/`, so hiding a link is never the only protection. A tool folder that is not listed in `lib/tools.js` is blocked for everyone.

Pages must not use inline `<script>` blocks or inline event handlers. The content security policy blocks them.

## Security summary

- Passwords: scrypt hashing, minimum 12 characters, forced change on first sign-in and after any reset.
- Sign-in: one generic error for every failure, 5 wrong passwords lock the account for 15 minutes, per-IP throttle.
- Sessions: random token in an HttpOnly, SameSite=Strict (and Secure in production) cookie; stored only as a hash; 30 minute idle timeout and 12 hour maximum; ended immediately when an account is turned off or reset.
- Writes require a per-session CSRF token, a JSON content type, and a matching Origin.
- Headers: strict content security policy (no inline script), no framing, no-store, no-index, HSTS in production.
- Audit log table records sign-ins, failures, lockouts and account changes (no passwords, no participant data).
- Certificate details are typed into the browser and printed from it. They are not sent to the server.
- The certificate artwork (`public/tools/certificates/certificate-bg.svg`) is the approved ADOC design, including the pre-printed signatures. Keep the repository private.

## Known gaps

- **No multi-factor sign-in yet.** Add TOTP codes before wide use.
- The certificate text uses Baskerville, which is installed on Macs. On Windows it falls back to Baskerville Old Face (installed with Microsoft Office) or Georgia, so lettering can look slightly different there.
- Anyone can deliberately lock a known email address by entering wrong passwords five times. A supervisor can reset it. Acceptable for a small team.
- The IP throttle is held in memory and resets when the server restarts.
