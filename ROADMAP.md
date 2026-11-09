# Roadmap

Open work only. Delete an entry in the PR that finishes it; git history is the record.

## Ideas

- Server log: give each server child its own log stream, so a respawn never interleaves with the previous child's output (audit NISHBOARD-002 follow-up).
- PowerShell/osascript spawns: apply the same env filter as `buildChildEnv` (they still inherit the full server env).
- Claude permission card: have the server send an explicit `truncated` flag instead of the client matching the `...truncated` marker.
