# macOS Production Distribution & User Authorization

Status: PROPOSED — production plan of record for Track C2/C3; implementation not started.
Date: 2026-07-23
Scope: direct macOS distribution, code identity, notarization, updates, and authorization
for Zotero, Eagle, Obsidian, and user-selected workspace data.

---

## 1. Executive decision

Astrolabe v1 will ship for macOS by **direct distribution outside the Mac App
Store**:

1. Join the Apple Developer Program.
2. Sign every public executable with one stable **Developer ID Application**
   identity owned by the Astrolabe release team.
3. Enable Hardened Runtime with the minimum Electron entitlements proven
   necessary.
4. Package both a consumer-facing DMG and an update ZIP.
5. Submit every release to Apple's notary service and staple the resulting
   ticket.
6. Distribute the notarized DMG from an Astrolabe-controlled HTTPS origin.
7. Ask users to authorize specific library roots through native folder pickers.
8. Request Full Disk Access only when a connector-specific test proves that
   user-selected-folder authorization is insufficient.

End users never receive, know, or enter a signing-key password. Signing and
notarization credentials exist only in the release environment. Users authorize
two separate things:

- **Launching Astrolabe:** Gatekeeper verifies the Developer ID signature and
  notarization ticket; the user confirms the ordinary first-launch dialog.
- **Reading library content:** the user chooses Zotero, Eagle, Obsidian, and
  workspace folders, and responds to any macOS-owned privacy prompt.

The Mac App Store is deferred. It requires a separate App Sandbox feasibility
project covering file bookmarks, local APIs, subprocesses, ACP/MCP clients,
updating, and licensing. Nothing in this spec claims that the direct build is
App-Store-ready.

---

## 2. Why this exists

Astrolabe is a local-first orchestrator over content owned by other tools. Its
core value requires reliable access to:

- Zotero's local HTTP API and file-backed attachments;
- Eagle's local HTTP API and file-backed library items;
- one or more Obsidian vaults;
- the Astrolabe workspace and its files-as-truth artifacts.

macOS evaluates both **software trust** and **data access**. A build can be
perfectly signed yet have no permission to read an iCloud vault. Conversely, a
locally trusted development build can read files but be rejected by Gatekeeper
on another Mac. Production must solve both layers deliberately.

The current self-signed development identity solves only local dogfooding. It
must never reach a customer.

---

## 3. Goals, non-goals, and invariants

### 3.1 Goals

- A customer downloads and opens Astrolabe without bypassing Gatekeeper.
- No customer sees a developer keychain or signing-password prompt.
- Astrolabe explains each data-access request before macOS presents it.
- Users authorize the narrowest root that makes a connector work.
- Denial is recoverable; one unavailable connector never prevents app launch.
- Updates retain the same code identity and do not re-prompt for previously
  authorized data under normal conditions.
- The release pipeline fails closed on unsigned, unnotarized, over-entitled, or
  unverifiable artifacts.
- Signing credentials never enter Git, application bundles, logs, crash
  reports, update metadata, or customer machines.
- The public identity is stable from the first beta onward.

### 3.2 Non-goals

- Windows and Linux packaging.
- Mac App Store distribution.
- Enterprise MDM deployment.
- Licensing, checkout, and activation protocol design.
- Cloud sync or account authorization.
- Circumventing TCC, Gatekeeper, System Integrity Protection, or App Sandbox.
- Automatically enabling Full Disk Access.

### 3.3 Invariants

1. **Production signs with Developer ID, never `Astrolabe Dev`.**
2. **A release without a valid signature or notarization ticket does not
   publish.**
3. **The signing private key is a developer secret, never an end-user
   credential.**
4. **The bundle identifier and Apple Team ID are release identity, not
   configuration knobs.**
5. **Authorization is connector-scoped and user-initiated.**
6. **Full Disk Access is an exception with a concrete failing probe, not an
   onboarding default.**
7. **A denied or missing path marks one library unavailable; it never deletes
   indexed content.**
8. **Astrolabe owns no source content and does not copy libraries to escape
   permissions.**

---

## 4. Vocabulary and trust boundaries

| Term | Meaning in this spec |
|---|---|
| Code signing identity | Certificate plus private key used by the release pipeline to sign Astrolabe. |
| Developer ID Application | Apple's direct-distribution certificate type used for the `.app`. |
| Designated Requirement (DR) | macOS rule used to decide whether two builds represent the same code identity. |
| Gatekeeper | macOS first-launch/download assessment for signature, notarization, and quarantine. |
| Hardened Runtime | Runtime protections required for notarization, with narrowly scoped exceptions. |
| Notarization | Apple's automated malware and signing check, producing a ticket. |
| Stapling | Attaching the notarization ticket to an artifact for offline verification. |
| TCC | Transparency, Consent, and Control: macOS privacy decisions for protected resources. |
| Files & Folders | Narrow TCC grants for locations such as Documents, Desktop, Downloads, iCloud Drive, and network volumes. |
| Full Disk Access (FDA) | Broad user-granted access to otherwise protected data; last resort. |
| App Sandbox | macOS capability restricting an application to a container and explicit entitlements. It is unrelated to Electron's renderer `webPreferences.sandbox`. |
| Security-scoped bookmark | Persistent capability for a user-selected URL in an App-Sandbox design. Its production use is conditional in this spec. |

### 4.1 Who holds what

| Actor | Holds | Never holds |
|---|---|---|
| Release pipeline | Developer ID private key, certificate chain, notarization credentials | Customer library paths or contents |
| Astrolabe application | User-selected paths, connector state, derived index | Developer ID private key |
| Customer | Their macOS account and privacy decisions | Astrolabe signing password |
| Apple | Developer ID chain, notarization submission, issued ticket | Astrolabe source-library authorization |

---

## 5. Verified current state and gap

Verified against the repository and installed development build on 2026-07-23:

- `electron-builder` 26.15.3 packages Electron 43.
- The application ID is `cool.astrolabe.app`.
- `electron-builder.yml` currently targets only `dir`.
- The configured identity is the self-signed `Astrolabe Dev`.
- `/Applications/Astrolabe.app` is signed, but `spctl` rejects it for public
  distribution because the origin is self-signed rather than Developer ID.
- The development build currently carries:
  - `com.apple.security.cs.allow-jit`;
  - `com.apple.security.cs.allow-unsigned-executable-memory`;
  - `com.apple.security.cs.disable-library-validation`.
- There is no release DMG/ZIP target, production entitlements file,
  notarization configuration, updater, publish provider, permissions onboarding,
  native folder-authorization surface, or release CI.
- Obsidian paths are still edited into
  `~/Astrolabe/.astrolabe/manifest.json`.
- The connector contract already exposes `accessProbePath()`, which is the
  correct seam for a future permission preflight.

### 5.1 Current connector access

| Connector | Metadata/control plane | On-disk access currently performed | Production authorization implication |
|---|---|---|---|
| Zotero | Keyless local API at `localhost:23119` | Hashes resolved attachments beneath the Zotero data directory, default `~/Zotero/storage` | API discovery can be automatic; attachment reads need a reachable, user-confirmed data root when protected. |
| Eagle | Tokenless local API at `localhost:41595` | Hashes item files inside the current `.library`; switch-all can visit several libraries | The user authorizes each discovered library root before content hashing; API control remains an explicit gesture. |
| Obsidian | None | Recursively reads and watches Markdown in each configured vault | Every vault must be selected in native UI; iCloud vaults may trigger Files & Folders consent. |
| Astrolabe workspace | Internal filesystem | Reads/writes `.astrolabe` files and disposable SQLite index | Let the user confirm or choose a workspace root; never request broader access for the workspace alone. |

---

## 6. Distribution channel

### 6.1 Direct distribution — selected

The public artifact set is:

- `Astrolabe-<version>-<arch>.dmg` — website/customer download;
- `Astrolabe-<version>-<arch>-mac.zip` — auto-update payload;
- `latest-mac.yml` — update metadata when the updater ships;
- checksums and release manifest;
- optional universal artifacts only after a measured need.

Both application architectures are built on macOS. Start with the hardware
architecture used by the beta cohort; add a second architecture or universal
build as a separately verified release capability.

The website must serve artifacts over HTTPS. Download pages identify the
publisher and provide release notes, version, supported macOS versions, and
checksum. Customers must not be instructed to use `xattr`, disable Gatekeeper,
or right-click around an unsigned build.

### 6.2 Mac App Store — deferred

Before considering the Store, run a dedicated feasibility phase for:

- App Sandbox and entitlement closure;
- persisted security-scoped bookmarks for every source root;
- local Zotero and Eagle APIs;
- spawning or communicating with Claude/Codex CLI processes;
- MCP/ACP subprocess packaging;
- licensing and purchase rules;
- App Store update behavior;
- any file write-back surface.

The direct build may remain non-App-Sandboxed while still using Hardened
Runtime. This does not relax TCC.

---

## 7. Production code identity

### 7.1 Stable identifiers

Freeze before the first external beta:

- Product name: `Astrolabe`
- Production bundle ID: `cool.astrolabe.app`
- Production helper IDs: derived from `cool.astrolabe.app`
- Production Apple Team ID: `<APPLE_TEAM_ID>` — unresolved until enrollment
- Production signing identity:
  `Developer ID Application: <LEGAL ENTITY> (<APPLE_TEAM_ID>)`
- Install location: `/Applications/Astrolabe.app`

Changing the bundle ID or Team ID after users grant access is a migration, not
a routine release. It requires a written plan, code-requirement comparison, and
fresh-machine test.

### 7.2 Separate development identity

Before the first public beta, split the installed development build:

- Product name: `Astrolabe Dev`
- Bundle ID: `cool.astrolabe.app.dev`
- Identity: local self-signed `Astrolabe Dev`
- Install path: `/Applications/Astrolabe Dev.app`

HMR remains `pnpm dev`. The split prevents Launch Services, deep links, logs,
TCC grants, and user expectations from crossing between local development and
production.

This split intentionally causes one final local development permission
migration. It must occur before public customers exist.

### 7.3 Certificate rotation

Developer ID certificates expire and may be revoked. Rotation procedure:

1. Generate the replacement under the same Apple Developer team.
2. Sign a candidate update with the replacement.
3. Extract the previous and candidate designated requirements.
4. Verify mutual compatibility with `codesign -R`.
5. Install over the previous release on a machine with recorded TCC grants.
6. Confirm no ordinary permission re-prompt.
7. Publish only after the compatibility gate passes.

If compatibility cannot be proven, treat rotation as an identity migration and
communicate the reauthorization requirement before release.

### 7.4 Migration from the current development build

The installed development app currently uses the production-candidate bundle
ID with a self-signed certificate. That is acceptable only before external
distribution. Migrate in this order:

1. Preserve the local development certificate as an internal recovery artifact.
2. Introduce the separate `cool.astrolabe.app.dev` configuration and install
   `Astrolabe Dev.app`.
3. Re-grant any development-only TCC access to that dev identity.
4. Remove the self-signed `/Applications/Astrolabe.app` after verifying the dev
   replacement.
5. Create the first production build as
   `cool.astrolabe.app`, signed with Developer ID.
6. Install it on internal machines and grant production TCC access once.
7. Record the first public designated requirement as the release baseline.

No self-signed build may be published, and no external beta may begin before
this split. Customers who first install the Developer ID build never encounter
the development certificate migration.

---

## 8. Signing-key and notarization credential custody

### 8.1 Developer ID private key

- Generated through the Apple Developer account by an authorized release owner.
- Exported once as an encrypted `.p12` for disaster recovery and CI.
- Stored in two independent encrypted locations controlled by the release
  owner; never committed.
- CI imports it into an ephemeral keychain using:
  - `CSC_LINK`;
  - `CSC_KEY_PASSWORD`.
- CI destroys the ephemeral keychain and workspace after the build.
- `forceCodeSigning: true` makes a missing identity fatal.
- Build logs must never echo environment variables, keychain passwords, base64
  certificate material, or signing command arguments containing secrets.
- Access to production signing secrets is limited to protected release jobs,
  not pull-request jobs or arbitrary branches.

Local development continues to use the self-signed development certificate.

### 8.2 Notarization authentication

Prefer an App Store Connect API key with the minimum role that can submit
notarization jobs. electron-builder currently recognizes:

- `APPLE_API_KEY`;
- `APPLE_API_KEY_ID`;
- `APPLE_API_ISSUER`.

Apple-ID/app-specific-password authentication is a fallback, not the default.
For a trusted local release machine, `notarytool store-credentials` plus a
keychain profile is acceptable. CI secrets remain isolated from application
signing secrets so either can rotate independently.

### 8.3 Incident response

On suspected signing-key compromise:

1. Stop publishing.
2. Revoke or coordinate revocation with Apple.
3. Preserve CI and notarization audit logs.
4. Rotate the certificate and release credentials.
5. Compare code requirements and assess user reauthorization impact.
6. Notarize and ship a clean higher-version release.
7. Publish a customer advisory with verified affected versions.

Never silently reuse a potentially compromised key.

---

## 9. Hardened Runtime and entitlements

### 9.1 Required posture

- `hardenedRuntime: true`.
- Secure timestamp enabled.
- No `com.apple.security.get-task-allow` in public builds.
- Explicit production entitlements and inherited entitlements files.
- Info.plist privacy-purpose strings exist only for protected resources the
  production build demonstrably uses, with connector-specific human copy.
- All nested executables, frameworks, helpers, native modules, and future
  MCP/ACP binaries signed before the outer app.
- `codesign --verify --deep --strict` must pass after packaging.

### 9.2 Entitlement minimization spike

The current automatically generated Electron entitlements are not accepted
unchanged merely because they work.

Test removal in this order:

1. `com.apple.security.cs.allow-unsigned-executable-memory` — modern Electron
   documentation warns that this increases attack surface and is generally
   unnecessary on Electron 12+.
2. `com.apple.security.cs.disable-library-validation` — remove unless a
   specific signed dependency fails under library validation.
3. Retain `com.apple.security.cs.allow-jit` only if Electron/V8 fails without
   it, which is expected but must be observed.

For every retained exception, record:

- the failing reproduction without it;
- the affected process;
- why a narrower alternative is unavailable;
- the test that prevents accidental removal or expansion.

Renderer `sandbox: false` is a separate Electron architecture decision. It
must not be described as disabling the macOS App Sandbox or TCC.

---

## 10. Packaging and notarization design

### 10.1 Target configuration

The production configuration will evolve conceptually toward:

```yaml
appId: cool.astrolabe.app
productName: Astrolabe

mac:
  target:
    - dmg
    - zip
  identity: "Developer ID Application: <LEGAL ENTITY> (<APPLE_TEAM_ID>)"
  hardenedRuntime: true
  forceCodeSigning: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.inherit.plist
  notarize: true
```

This is a target contract, not permission to paste placeholders into a release
configuration. Exact electron-builder fields and environment variables are
re-verified against the installed version during implementation.

### 10.2 Build sequence

1. Start from a clean, tagged commit with a nonzero semantic version.
2. Install dependencies from the lockfile.
3. Rebuild native modules against the packaged Electron ABI.
4. Run typecheck, lint, unit/component tests, and integration tests.
5. Build Electron main, preload, and renderer bundles.
6. Audit packaged file inventory and ASAR unpack list.
7. Sign nested code and outer app using Developer ID.
8. Verify signature and entitlements.
9. Produce the notarization submission artifact.
10. Submit the signed application/DMG to Apple's notary service.
11. Wait for success and archive the notary log.
12. Staple and validate the ticket on the `.app` and DMG. A ZIP cannot itself
    be stapled; it must contain the already-stapled `.app`.
13. Produce or finalize the customer DMG and update ZIP without invalidating
    the signed/stapled application.
14. Run Gatekeeper assessment.
15. Install and launch the quarantined artifact on a clean macOS account/VM.
16. Publish immutable artifacts and update metadata.

### 10.3 Required mechanical gates

Representative checks:

```bash
codesign --verify --deep --strict --verbose=2 /path/to/Astrolabe.app
codesign --display --verbose=2 --entitlements - /path/to/Astrolabe.app
spctl --assess --type execute -vv /path/to/Astrolabe.app
xcrun stapler validate /path/to/Astrolabe.app
```

Expected Gatekeeper source is **Notarized Developer ID**. “Command exited
zero” is insufficient if the output names the wrong identity, bundle ID,
entitlements, architecture, or artifact.

The public download test must preserve the quarantine attribute. Opening a
local build directory does not exercise the customer Gatekeeper path.

---

## 11. End-user installation experience

### 11.1 Website to first launch

1. User downloads the Astrolabe DMG over HTTPS.
2. User opens the DMG.
3. User drags Astrolabe into Applications.
4. User launches `/Applications/Astrolabe.app`.
5. Gatekeeper verifies Developer ID and notarization.
6. macOS shows its standard first-launch information.
7. User chooses **Open**.
8. Astrolabe starts onboarding before scanning protected paths.

Astrolabe must never instruct a customer to:

- enter a developer keychain password;
- trust a self-signed certificate;
- disable Gatekeeper;
- run `xattr -d com.apple.quarantine`;
- run the app from a mounted DMG;
- grant Full Disk Access before a narrower probe has failed.

### 11.2 What Gatekeeper approval does not mean

Clicking **Open** authorizes execution. It does not grant Astrolabe access to
Documents, iCloud Drive, another application's data, contacts, calendars,
camera, microphone, or the full disk. Data authorization occurs separately and
in context.

---

## 12. Authorization UX

### 12.1 Design law

Authorization follows:

> Explain → user gesture → native chooser or system prompt → probe → observable
> result → persist only what was granted.

Do not trigger multiple unrelated prompts at launch. Do not ask “Allow access”
without naming the connector, folder, operation, and privacy boundary.

### 12.2 Permission state model

Every configured root has one explicit state:

```text
unconfigured
checking
authorized
connector_offline
permission_required
denied
missing_or_moved
error
```

Do not collapse these:

- Zotero not running is `connector_offline`, not `denied`.
- `ENOENT` is `missing_or_moved`, not `permission_required`.
- `EACCES`/`EPERM` after a native selection is permission failure.
- An empty library is authorized and empty, not unavailable.
- A timed-out local API is connector failure, not file denial.

Each state provides one next action and preserves the indexed library as
dormant when unreachable.

### 12.3 Native folder selection

Add typed IPC from the renderer to a main-process native folder chooser. The
renderer must never receive general filesystem authority.

Required choices:

- Choose Astrolabe Workspace;
- Choose Zotero Data Directory;
- Add Obsidian Vault;
- Authorize Eagle Library.

Picker requirements:

- directory selection only;
- initiated by an explicit click;
- defaults to a detected path when available;
- shows the chosen absolute path before confirmation;
- verifies expected shape without requiring every optional file;
- never silently broadens from a library folder to a parent home directory;
- supports replacing and removing a root;
- stores normalized paths only after a successful probe.

### 12.4 Persistence

For the selected direct, non-App-Sandbox v1:

- store normalized connector paths in the files-as-truth manifest;
- re-probe them at every launch;
- rely on stable code identity and macOS TCC decisions;
- never claim that a stored path itself grants access.

If App Sandbox is adopted later:

- create app-scoped, security-scoped bookmarks from native user selection;
- store bookmark data securely with the connector root record;
- resolve and start scoped access before file operations;
- stop access when work ends;
- detect stale bookmarks and ask the user to reselect;
- test bookmarks across restart, update, folder move, and revocation.

Bookmark implementation is therefore **conditional on the App Sandbox
decision**, not silently assumed for the direct v1 build.

### 12.5 Preflight and recovery

The existing connector `accessProbePath()` surface becomes a typed permission
preflight:

1. Resolve the configured root.
2. Perform the minimum harmless read needed to prove access.
3. Classify the result without mutating source data.
4. Return connector, root, state, system error code, and recommended action.
5. Never infer deletion or run a removal sweep after access failure.

Recovery actions:

- `connector_offline` → **Open Zotero/Eagle and Retry**
- `permission_required` → **Choose Folder**
- `denied` → **Open Privacy Settings** plus manual instructions
- `missing_or_moved` → **Locate Folder**
- `error` → **View Details** and **Retry**

System Settings URLs are version-sensitive. Any deep link must be verified on
every supported macOS version; always provide readable navigation instructions
as fallback.

---

## 13. Connector-specific authorization contracts

### 13.1 Zotero

Current behavior:

- metadata, groups, collections, items, annotations, and cursors come from
  `http://localhost:23119/api`;
- attachment paths are resolved under the Zotero data directory and hashed on
  disk;
- default data directory is `~/Zotero`.

Production flow:

1. Detect whether Zotero's local API is reachable.
2. Read metadata without asking for Full Disk Access.
3. Resolve the reported/default data directory.
4. Probe `<dataDir>/storage`.
5. If inaccessible or non-default, ask **Choose Zotero Data Directory**.
6. Validate that the chosen folder plausibly contains Zotero storage.
7. Hash only attachments below the authorized root.

An unreadable attachment degrades to no content-hash join; it does not fail the
metadata scan or fabricate deletion.

User-facing explanation:

> Astrolabe reads Zotero metadata from Zotero's local API. To match and open
> file-backed attachments, choose your Zotero data folder. Astrolabe does not
> modify Zotero files.

### 13.2 Eagle

Current behavior:

- metadata, library history, switching, and item lists come from
  `http://localhost:41595`;
- Astrolabe hashes resolvable item files inside each `.library`;
- switching Eagle libraries is an explicit visible operation.

Production flow:

1. Detect Eagle's local API.
2. Read the current library path and history.
3. For each library whose files will be hashed, show **Authorize Eagle
   Library** with the exact `.library` path.
4. Require an explicit native folder selection when the path is protected.
5. Store authorization per stable normalized library path.
6. Preserve the existing confirmation before sync-all switches Eagle through
   multiple libraries.

Never request the parent iCloud Drive root when selecting one `.library` is
sufficient.

User-facing explanation:

> Astrolabe reads Eagle metadata through Eagle's local API. Choose this Eagle
> library so Astrolabe can hash local files for cross-library matching.
> Astrolabe does not modify the library.

### 13.3 Obsidian

Current behavior:

- Astrolabe directly walks, reads, and watches Markdown files;
- vault paths are configured manually in the workspace manifest;
- hidden directories and non-Markdown files are skipped.

Production flow:

1. Replace manifest editing with **Add Obsidian Vault**.
2. Require one native folder selection per vault.
3. Explain that Markdown is read for search, links, and backlinks.
4. Probe the root and start the watcher only after authorization succeeds.
5. Treat a moved or revoked vault as dormant.
6. Support reselect, remove, and multiple vaults.

User-facing explanation:

> Choose an Obsidian vault to index its Markdown notes and links. Astrolabe
> reads the selected vault and watches it for changes; it does not modify your
> notes.

### 13.4 Astrolabe workspace

- Default may remain `~/Astrolabe` only if a clean-machine test shows it causes
  no unnecessary protected-folder prompt.
- Allow a native workspace choice.
- Explain which data is authored (folders, ledgers, marks, dialogues) and which
  is disposable (derived index).
- Refuse a source-library folder as the workspace if nesting would cause
  recursive watches or ownership confusion.
- Workspace failure stops writes but does not mutate any source.

---

## 14. Full Disk Access policy

### 14.1 Default

Astrolabe does not request FDA during ordinary first-run onboarding.

### 14.2 Eligibility

FDA may be offered only when all are true:

1. The user selected the narrow source folder through native UI.
2. A connector-specific harmless read still returns a verified TCC denial.
3. The source is required for a feature the user explicitly invoked.
4. No supported API or narrower folder grant supplies the same access.
5. The UI explains exactly what remains inaccessible.

### 14.3 User flow

1. Show a preflight explanation before opening settings.
2. Name the affected connector and path.
3. State that FDA allows broad filesystem access and is optional.
4. Provide **Open Full Disk Access Settings** and **Not Now**.
5. macOS requires the user to add or enable Astrolabe.
6. Offer **Quit and Reopen Astrolabe** if required.
7. Re-run the exact probe after relaunch.

The app cannot grant itself FDA. It must not simulate clicks, request an
administrator password, or claim success until the probe passes.

### 14.4 Denial

If the user declines:

- keep the connector or affected file surface unavailable;
- retain previously indexed content as dormant/ghosted per existing semantics;
- continue running all other features;
- make the decision reversible from Settings;
- do not nag on every launch.

---

## 15. Updates and permission continuity

### 15.1 Identity law

Every public update preserves:

- bundle ID;
- Apple Team ID;
- compatible designated requirement;
- helper IDs;
- install path;
- release channel.

macOS uses code requirements to reason about whether an update is the same
application. Release qualification therefore compares the previous and
candidate requirements rather than assuming that matching product names are
enough.

### 15.2 Auto-update

When introduced, use `electron-updater` with:

- a signed, notarized, stapled app inside the DMG and update ZIP;
- `zip` target and `latest-mac.yml`;
- HTTPS update origin;
- signature validation;
- explicit stable/beta channels;
- staged rollout support;
- visible download/restart state;
- no update install while a connector sync or files-as-truth write is active.

Dependencies arrive only with their first consumer. The updater does not enter
the package before its UI, recovery behavior, and integration tests exist.

### 15.3 Update acceptance

On a machine with authorized libraries:

1. Install release N.
2. Grant only the minimum connector permissions.
3. Populate real state.
4. Update in-app to release N+1.
5. Verify signature and new version.
6. Re-probe every connector.
7. Confirm no ordinary TCC reauthorization.
8. Confirm files-as-truth state and disposable index remain consistent.

Also test revoked permissions, interrupted download, corrupted metadata,
offline update origin, application relocation, and rollback recovery.

---

## 16. Release pipeline

### 16.1 Authority boundaries

- Pull requests: build and test unsigned artifacts; no production secrets.
- Protected release branch/tag: may request production signing environment.
- Release job: requires human approval until the process is mature.
- Publish job: consumes only artifacts that passed signing, notarization, and
  clean-machine smoke gates.
- Website/CDN credentials are separate from Apple credentials.

### 16.2 Release manifest

Archive for every release:

- Git commit and tag;
- app version and build number;
- Electron/electron-builder versions;
- architecture and minimum macOS version;
- bundle ID, Team ID, certificate SHA-256/serial, and designated requirement;
- entitlements dump for main and helpers;
- `codesign` verification output;
- notarization submission ID and full log;
- stapler validation output;
- Gatekeeper assessment;
- SHA-256 for every published artifact;
- automated gate results;
- clean-machine smoke result;
- previous-version update result.

No secret material belongs in the manifest.

### 16.3 Reproducibility and provenance

- Builds start from a clean checkout and lockfile.
- Release scripts reject dirty trees and untagged versions.
- Artifact hashes are calculated after all signing and stapling.
- Published files are immutable; a correction increments the version.
- Source maps and debug symbols are access-controlled and keyed by release.
- CI actions and third-party build tools are pinned.

---

## 17. Failure UX and support diagnostics

### 17.1 Customer-visible categories

| Category | Message direction | Action |
|---|---|---|
| Gatekeeper/install | “This copy could not be verified.” | Download again from official origin; never advise bypass. |
| Connector offline | “Open Zotero/Eagle to sync.” | Open app and Retry. |
| Folder not selected | “Choose the folder Astrolabe may read.” | Native picker. |
| Permission denied | “macOS denied access to this selected folder.” | Open Privacy Settings / Reselect. |
| Folder moved | “The configured folder is no longer here.” | Locate Folder. |
| FDA required | Explain verified limitation and scope. | Open FDA Settings / Not Now. |
| Signature/update | “The update could not be verified and was not installed.” | Retry / Download manually. |

### 17.2 Diagnostics

Support export may include:

- app version, macOS version, architecture;
- signature identity summary and notarization status;
- connector availability;
- configured-path hashes or redacted basenames, not full paths by default;
- permission state and OS error codes;
- recent structured logs with document content removed.

It must never include:

- signing/notarization credentials;
- license secrets;
- raw library contents;
- API keys;
- private full paths without explicit user opt-in.

---

## 18. Verification matrix

### 18.1 Packaging and trust

- Developer ID identity present.
- Build fails when identity is absent.
- Hardened Runtime present.
- No `get-task-allow`.
- Entitlements equal the reviewed allowlist.
- Every helper/native executable is signed.
- DMG and ZIP produced.
- Notarization accepted.
- Ticket stapled to the app and DMG and validated offline; update ZIP contains
  the stapled app.
- Gatekeeper accepts a quarantined download.
- Tampered app is rejected.
- Wrong/self-signed identity is rejected by the release job.

### 18.2 Fresh-user authorization

Test on a clean macOS account or disposable VM:

- install from browser-downloaded DMG;
- first-launch Gatekeeper flow;
- Zotero running/not running;
- Zotero/Eagle loopback APIs on every supported macOS version, including any
  Local Network privacy behavior;
- default and custom Zotero data directories;
- Eagle running/not running;
- Eagle library in iCloud Drive;
- multiple Eagle libraries and sync-all restore;
- one local and one iCloud Obsidian vault;
- user denies each prompt;
- user later grants access;
- folder moves after authorization;
- permission revoked in System Settings;
- restart and machine reboot;
- app update with grants already present;
- app copied outside `/Applications`;
- no FDA;
- FDA only where a verified case requires it.

### 18.3 Regression expectations

- Access failure never triggers removal sweep.
- One denied connector does not block another.
- Denied libraries remain dormant, not deleted.
- User can remove a configured root without deleting source data.
- Reauthorization updates the path without duplicating library identity when
  the stable source is unchanged.
- No prompt loop occurs on repeated denial.
- HMR and production grants remain separate after the dev bundle-ID split.

---

## 19. Implementation sequence

### P0 — Decisions and Apple account

- Enroll legal entity/account holder.
- Freeze Team ID and production bundle ID.
- Select minimum supported macOS version and architecture plan.
- Decide release origin and update provider.
- Generate Developer ID Application certificate.
- Document backup and incident owners.

Exit: a manually signed “hello” app is accepted as Developer ID on a clean Mac.

### P1 — Identity split and entitlement closure

- Separate dev and production product/bundle IDs.
- Add explicit production entitlement files.
- Run the entitlement minimization spike.
- Add signature/DR audit scripts.
- Keep the current dev install flow operational under the dev ID.

Exit: dev and production can coexist without shared Launch Services or TCC
identity.

### P2 — Authorization surface

- Add native directory-picker IPC.
- Add connector-root records to files-as-truth configuration.
- Implement permission states and preflight classification.
- Replace manual Obsidian manifest editing.
- Add Zotero/Eagle root confirmation.
- Add recovery and Settings UI.

Exit: all real libraries work on a clean user account without FDA unless an
evidenced exception is recorded.

### P3 — Production packaging

- Add DMG and ZIP targets.
- Add icon, versioning, copyright, minimum OS, entitlements, and signing
  configuration.
- Set `forceCodeSigning`.
- Verify packaged resources and native modules.
- Add local release-candidate script.

Exit: signed production artifacts pass local signature verification.

### P4 — Notarization and CI

- Add protected macOS release runner.
- Inject Developer ID and App Store Connect API credentials.
- Notarize, staple, assess, hash, and archive logs.
- Enforce tag/version/clean-tree gates.
- Run clean-machine Gatekeeper smoke.

Exit: a quarantined DMG installs without security bypass.

### P5 — Updater

- Add updater dependency and publish metadata.
- Build explicit update UI and safe restart coordination.
- Test N→N+1 identity and permission continuity.
- Add staged rollout and failure recovery.

Exit: an installed production build updates without losing connector access or
files-as-truth state.

### P6 — Beta release qualification

- Run the full verification matrix.
- Exercise denial and revocation, not only happy paths.
- Review privacy copy and diagnostics.
- Freeze support runbook.
- Publish to a small cohort before wider release.

Exit: customers can install, authorize selected libraries, update, revoke
access, and recover without developer intervention.

---

## 20. Open decisions and required spikes

These are unresolved; the implementation must not assume answers:

1. **Apple legal entity and Team ID.**
2. **Minimum macOS version.**
3. **arm64-only, dual-architecture, or universal initial release.**
4. **Artifact/update origin:** generic HTTPS/R2, GitHub Releases, or another
   provider.
5. **Direct non-App-Sandbox behavior of native folder selection across every
   supported macOS version.** Verify rather than assuming persistence.
6. **Whether any real connector still needs FDA after user-selected folder
   authorization.** Test Zotero storage, iCloud Eagle, and iCloud Obsidian
   separately.
7. **Whether loopback Zotero/Eagle APIs trigger Local Network authorization**
   on any supported macOS release, and the required purpose copy if they do.
8. **Minimum Electron entitlements** for the exact production bundle.
9. **Developer ID rotation compatibility** with the first public designated
   requirement.
10. **Updater channel and rollback policy.**
11. **Whether the production workspace is fixed or user-selected by default.**

Each spike ends with an observed result, reproducible test conditions, and a
recorded decision. “Works on the developer Mac” is not evidence for customer
authorization.

---

## 21. Acceptance criteria

This spec is implemented only when:

1. No public artifact contains or requires `Astrolabe Dev`.
2. A browser-downloaded DMG passes Gatekeeper on a clean supported Mac.
3. The app and every helper are Developer ID signed with reviewed entitlements.
4. Notarization and stapling validate.
5. A customer never sees a developer keychain/password prompt.
6. Zotero, Eagle, and Obsidian can each be authorized through in-app user
   gestures.
7. Denial, revocation, moved folders, and offline connector states are
   distinguishable and recoverable.
8. FDA is absent from default onboarding and every exception has a reproduced
   justification.
9. Release N→N+1 preserves code identity and ordinary data grants.
10. CI fails closed when signing, notarization, entitlements, or Gatekeeper
    assessment is wrong.
11. Signing and notarization secrets are recoverable by authorized maintainers
    but absent from Git and customer systems.
12. The full clean-machine authorization matrix is recorded green.

---

## 22. Authoritative references

Platform requirements change. Re-check these primary sources at implementation
and release time:

- Apple — [Signing Mac Software with Developer ID](https://developer.apple.com/developer-id/)
- Apple — [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- Apple — [Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)
- Apple — [TN3127: Inside Code Signing Requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)
- Apple — [Applying Code Requirements](https://developer.apple.com/documentation/security/applying-code-requirements)
- Apple — [Controlling app access to files in macOS](https://support.apple.com/guide/security/controlling-app-access-to-files-secddd1d86a6/web)
- Apple — [Change Privacy & Security settings on Mac](https://support.apple.com/guide/mac-help/change-privacy-security-settings-on-mac-mchl211c911f/mac)
- Apple — [Accessing files from the macOS App Sandbox](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)
- electron-builder — [macOS configuration](https://www.electron.build/mac/)
- electron-builder — [Code Signing for macOS](https://www.electron.build/docs/features/code-signing/code-signing-mac/)
- electron-builder — [macOS Notarization](https://www.electron.build/docs/notarization/)
- electron-builder — [Auto Update](https://www.electron.build/docs/features/auto-update/)
- Electron — [`@electron/notarize`](https://github.com/electron/notarize)

Last source verification: 2026-07-23.
