# Source Registry — legacy definitions

Nothing here is authority. These files are history.

`loadVerifiedSourceRegistry()` reads only `SOURCE_REGISTRY_ARTIFACT_PATH`
(default `source-registry/national-registry.json`). No file in this directory is on that path,
and none may be placed there.

---

## geo-sources-superseded.json

The three entries that occupied `national-registry.json` before the first real GOVERNOR
approval: `reg-sgu-001` (SGU), `reg-nv-001` (Naturvårdsverket), `reg-smhi-001` (SMHI).

Preserved **verbatim**, wrapped in a classification header, with the SHA-256 of the source file
as it stood at preservation time. The entries are not rewritten or "modernised" — a historical
record that has been tidied is no longer a record of what was there.

### Why they were removed rather than reissued

They predate the frozen `SourceRegistryArtifact` contract and fail it on every required field:

```
missing : source_id, producer, channel, adapter, artifact_types,
          collection_frequency, change_detection, policy,
          lifecycle_state, approval_attestation
present : endpoint, approved_by, approved_at   (an older shape)
```

`loadVerifiedSourceRegistry()` runs `verifySourceRegistryArtifact()` on **every** entry and
throws on the first failure. So while these sat in the production file, the registry could not
be loaded at all — the P2 runtime blocker that stalled the download engine for most of a day.

Reissuing all three alongside the first legal source would have meant legitimising four sources
at once, in a milestone whose whole purpose is to establish that **one** source went through the
full authority path correctly. One genuinely verified source is worth more than one verified
source plus three historical pseudo-authorities.

### What this does NOT mean

SGU, Naturvårdsverket and SMHI data is not discarded, and their harvest history is not
invalidated. Only these unattested *definitions* lose their place in the file that claims to be
production authority.

### Reissue

`P2-SR-REISSUE-GEO`, one source at a time. Each returns only when its real `source_id`,
`allowed_domains`, `endpoint`, `adapter`, `change_detection`, operational policy,
`artifact_types` and approval scope have been reviewed and signed to the same standard as
PUH/MMOD. Copying the old values forward would reproduce the problem this directory exists to
record.
