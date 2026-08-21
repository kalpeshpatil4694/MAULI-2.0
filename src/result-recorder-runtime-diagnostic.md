# Runtime Result Recorder Diagnostic

The Worker must record the runtime Result update using `GITHUB_TOKEN` and verify the GitHub Contents API read-back before returning success. The `/api/command` response should expose `resultFile.diagnostics` so failures identify token/read/write/verify stage.