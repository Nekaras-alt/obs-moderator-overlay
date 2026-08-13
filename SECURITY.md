# Security

OBS Moderator Overlay treats the **moderator PIN** as full control of the overlay (layers, media, some OBS toggles). Treat it like a password.

## Reporting vulnerabilities

Please **do not** open a public GitHub issue for exploitable bugs.

Email the maintainer listed on the GitHub profile / release notes, or use GitHub **Security advisories** on this repository. Include:

- Version (`1.0.0` / `buildStamp` from `/api/hello`)
- Host vs remote mode
- Steps to reproduce (no real PINs or tokens)

## What we consider in-scope

- PIN / session bypass, leaking `data/.secret` or viewer tokens
- Remote connector / relay issues that expose the host without a join code
- XSS in the editor that runs in the OBS Browser Source context

See [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

## What we do not consider a vulnerability

- Access after someone is given a valid PIN or join code
- Exposing port 8090 to the internet (unsupported; documented as unsafe)
- Missing code signing on Windows builds (community unsigned releases)

## Hardening checklist

- Bind locally / use relay + harden (`OMO_HARDEN=1`)
- Do not Funnel or port-forward 8090 or OBS WebSocket 4455
- Keep `.env` and `data/.secret` out of git and out of public zip files
