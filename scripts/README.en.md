# Development tools and compatibility entry points

[简体中文](README.md) | **English**

Current product packages live in [plugins/](../plugins/README.en.md), and the source launcher in [launcher/](../launcher/README.en.md). The main launcher implementation is not duplicated here.

| File | Purpose |
|---|---|
| `check-dsh-versions.mjs` | Read-only DSH compatibility checks across three manifests, lockfiles, registered source references, and the tutor market entry |
| `prepare-release.mjs` | Independently build, test, and pack one product with checksums and release notes; never publish to npm |
| `test/` | Regression tests for development/release tooling without root runtime dependencies |
| `corilo.mjs` | Compatibility forwarder to launcher/corilo.mjs using the same instance configuration |
| `vendor-astryx.mjs` | Extract selected design tokens from a pinned Astryx CSS archive verified by SHA-256, without network or React installation |
| `p0.py`, `verify_delete_guard.py`, `verify_pinned.py` | Historical Files.md P0 evidence/regression tools kept at their original paths |

The P0 tools resolve the repository root relative to their own paths. See the [history index](../docs/history/README.md) for the original repository bootstrap and the [systemd examples (Chinese)](../deploy/systemd/README.md) for service configuration.

Run `npm run check:dsh` and `npm run test:tooling` for development checks. Independent release preparation is described in the [release guide](../docs/RELEASING.en.md).
