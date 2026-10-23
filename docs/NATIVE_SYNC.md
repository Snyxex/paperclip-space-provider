# SPACE native filesystem sync: implementation and safety gate

The provider now implements an opt-in native-incubating mode for current SPACE native files endpoints. Verified against the current public source contract at https://github.com/perplexityai/SPACE/tree/main/crates/libs/api/src/routes/public and https://github.com/perplexityai/SPACE/blob/main/crates/libs/public/api/src/routes.rs.

## SPACE API contract

- POST /v1/sandboxes/{sandbox_id}/files:stat — JSON {path}; {entry:{file_type,size_bytes,link_count,...}}.
- POST /v1/sandboxes/{sandbox_id}/files:list — JSON {path,depth:1}; {entries:[...]}.
- POST /v1/sandboxes/{sandbox_id}/files:mkdir — JSON {path,parents:false} with Idempotency-Key.
- POST /v1/sandboxes/{sandbox_id}/files:write — JSON {path,data_base64,append,parents:false}, Idempotency-Key; {bytes_written}. API currently limits one request to 16 MiB; this provider uses 512-KiB chunks.
- POST /v1/sandboxes/{sandbox_id}/files:read — JSON {path,offset,length}; binary application/octet-stream response. Reads are checked for exact byte count.
- POST /v1/sandboxes/{sandbox_id}/files:rename — JSON {old_path,new_path} with Idempotency-Key; {ok:true}.
- POST /v1/sandboxes/{sandbox_id}/files:remove — JSON {path,recursive:false} with Idempotency-Key; {ok:true}.

These operations are Incubating, not stable M1. The earlier command-experimental mode must never be silently used as a fallback; the code chooses each transport explicitly. No secrets are sent to guest commands for native file transfers, but the SPACE management API sees uploaded file contents.

## Implemented safeguards

- Workspace mapping checks are performed before transfers; each local path must be confined to Paperclip's workspace.localPath. Guest paths are restricted to /paperclip-workspace.
- Host local symlinks and files with multiple hardlinks are rejected; guest file stat requires known link count 1 and rejects symlinks.
- Bounded per-file/total counts: 16 MiB, 64 MiB total, 512 files and 24 directory levels. No unbounded binary response accumulation.
- Input file transfer uses a random guest-side staged file and a final rename, with cleanup attempt on failures; output uses an exclusive temporary host file, sync, then rename.
- Directory exclude patterns are applied to relative entries; unsupported mapping kinds, post-upload commands and symlink following are rejected.
- Timeouts, failed network requests or uncertain mutation outcomes are errors; no blind retried mutation.

## Blockers before production or npm release

1. **Disposable VM integration** on node02 (see [manual integration test](INTEGRATION.md); never auto-run in Jenkins): confirm SPACE deployment implements the exact incubating API, run binary/nested-directory round trips, empty files, excludes, large files, midtransfer failures, and verify cleanup. Do not supply company code or private secrets.
2. **Adversarial race review:** host and guest filesystems can change between stat and read/write/rename; per-operation path checks reduce accidental escapes but cannot guarantee race-free isolation against hostile concurrent writers. For multi-tenant untrusted inputs, require a stronger root-descriptor-based approach and guest-side filesystem containment guarantees.
3. **Cancellation and timeout cleanup:** add AbortSignal propagation, bounded execution, reconciliation of unknown mutation outcomes, and auditing without leaking file bytes.
4. **Directory atomicity:** multiple files are not a single transaction; if a later file fails, earlier paths may already have changed. Implement staging/manifest validation and recovery strategy where needed.
5. **Mode preservation:** file mode changes use guest chmod when specifically requested. Verify ownership/permissions semantics and restrict executable bits for untrusted data.
6. **Paperclip integration:** verify actual SDK sync hooks, workspace root expectations, and post-upload commands. The latter intentionally fail until reviewed.
7. **Supply chain:** review license and dependency updates; npm publication stays gated to reviewed tag at latest main.

The current Jenkins build only verifies syntax, mocks, and package contents. A successful CI run does not prove sandbox/host compatibility.
