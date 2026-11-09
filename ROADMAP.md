# Roadmap

Open work only. Delete an entry in the PR that finishes it; git history is the record.

## Ideas

- Server log: give each server child its own log stream, so a respawn never interleaves with the previous child's output (audit NISHBOARD-002 follow-up).
- PowerShell/osascript spawns: apply the same env filter as `buildChildEnv` (they still inherit the full server env).
- Claude permission card: have the server send an explicit `truncated` flag instead of the client matching the `...truncated` marker.

## Audit 2026-11-08 follow-ups

The high findings shipped in #190, the 70 medium findings in the audit wave 2 PR; the 169 low and 32 nit findings are still open (full list in Nish's local report `C:\Code\.audit\2026-11-08\nishboard.md`).

- Command palette fill rows: prefill the input on select once @nish/ui exposes a controlled query (NISHBOARD-037 follow-up).
- Hardware widget: real Windows disk I/O from the PhysicalDisk perf counters (NISHBOARD-074 follow-up; the I/O row is hidden until then).
