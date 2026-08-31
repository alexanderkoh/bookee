# Distribution

How Bookee reaches a machine, and the one thing that makes it harder than it
looks.

## What gets built

`pnpm tauri build` produces a native installer for whichever platform it runs
on. There is no cross-compilation: a macOS `.dmg` can only be built on macOS, a
Windows `.msi` only on Windows. That is why the release workflow uses three
runners.

| Platform | Artifacts | Notes |
| --- | --- | --- |
| macOS | `Bookee.app`, `Bookee_<version>_<arch>.dmg` | `.dmg` is the thing people download; drag to Applications |
| Windows | `.msi` (WiX), `.exe` (NSIS) | either works; `.exe` is the friendlier default |
| Linux | `.AppImage`, `.deb`, `.rpm` | AppImage needs no install — `chmod +x` and run |

Apple Silicon and Intel are different binaries. The release workflow builds
`--target universal-apple-darwin`, producing one `.dmg` that runs on both at
roughly double the size.

## The actual hard part: signing

The build is the easy half. An **unsigned** application is treated as hostile by
both desktop operating systems, and this is what determines whether a download
feels like a product or like malware.

### macOS

Without an Apple Developer ID certificate, a downloaded `.dmg` produces:

> "Bookee" cannot be opened because the developer cannot be verified.

The user's escape hatch is right-click → Open → Open, or removing the quarantine
flag by hand:

```bash
xattr -dr com.apple.quarantine /Applications/Bookee.app
```

That is fine for you and hopeless for anyone else. Fixing it properly needs:

1. An **Apple Developer Program** membership — $99/year.
2. A **Developer ID Application** certificate, exported as `.p12`.
3. **Notarisation**: Apple scans the signed build and issues a ticket, which is
   stapled into the `.dmg`. Without the ticket, Gatekeeper still complains even
   for a signed app.

The release workflow enables signing only when `APPLE_CERTIFICATE` is set and
non-empty. That condition matters: Tauri treats a *defined but empty*
`APPLE_CERTIFICATE` as "signing was requested" and fails the bundle step trying
to import a certificate that is not there — so passing the secret through
unconditionally breaks the unsigned build rather than falling back to it.

Add the secrets and signed, notarised builds come out with no code changes.

### Windows

Unsigned installers trigger SmartScreen:

> Windows protected your PC — Microsoft Defender SmartScreen prevented an
> unrecognized app from starting.

The user can click "More info" → "Run anyway". Removing the warning needs an
Authenticode certificate (roughly $100–400/year). An OV certificate builds
reputation over time and downloads; an EV certificate clears SmartScreen
immediately but usually requires a hardware token.

### Linux

No equivalent problem. AppImage, `.deb` and `.rpm` all install unsigned without
ceremony.

## Cutting a release

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow builds all three platforms and opens a **draft** release with the
artifacts attached. Check them, then publish.

To try it locally first:

```bash
pnpm tauri build              # release build for this machine
pnpm tauri build --debug      # faster, unoptimised, for testing the bundle
```

## What is deliberately absent

- **No auto-updater.** Tauri ships one, and it needs a signing keypair plus a
  hosted update manifest. Out of scope for v0.1; the architecture does not block
  it.
- **No telemetry**, so there are no download or usage numbers. That is the
  trade for not phoning home.
- **No app store distribution.** The Mac App Store requires sandboxing, which
  conflicts with letting the user choose an arbitrary file location for their
  backup.

## The honest recommendation

For an open-source tool with technical users, unsigned GitHub releases plus a
line in the README about the Gatekeeper warning is entirely normal and costs
nothing. Pay for signing when you are handing the app to people who did not
choose to install a developer tool — the $99/year buys the difference between
"drag to Applications" and a support conversation about security warnings.
