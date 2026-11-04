Kept is designed so that you don't have to trust Kept. Every event on every promise is a signed receipt, and the receipts are chained so that changing or removing one is detectable.

## Journal entries

Each entry is canonical JSON (sorted keys, no whitespace):

```json
{ "v": 1, "stream": "<contract id>", "seq": 7, "at": 1793806545132,
  "actor": "paypal", "type": "paypal.captured", "data": { "...": "..." },
  "prevHash": "<hash of entry 6>" }
```

- `hash = sha256(canonical JSON)`
- `prevHash` links to the previous entry of the same promise (the first links to 64 zeros)
- `sig` is an Ed25519 signature over the hash, with the key named by `keyId`

The public keys are at [`{{KEYS}}`]({{KEYS}}).

## Verify a chain

```ts
import { verifyChain } from "@kept/core";

const keys = await fetch("{{KEYS}}").then((r) => r.json());
const publicKeys = Object.fromEntries(keys.keys.map((k) => [k.keyId, k.publicKey]));
const result = verifyChain(entries, publicKeys);
// { ok: true, checked: 23 } or { ok: false, failedAt, reason }
```

`verifyChain` recomputes every hash, follows every link from the first entry, and checks every signature. The contract page's **Verify in browser** button does exactly this.

## The transparency log

Entries from all promises are batched into checkpoints, an RFC 6962 Merkle tree over entry hashes. Each checkpoint is signed and links to the previous checkpoint, so the whole log is append-only.

| Endpoint | Returns |
|---|---|
| `GET /v1/transparency/checkpoints` | Recent checkpoints with their roots, signatures and validity |
| `GET /v1/transparency/proof/{entryHash}` | An inclusion proof for one entry against a signed checkpoint |

```ts
import { verifyInclusion } from "@kept/core";
verifyInclusion(entryHash, leafIndex, treeSize, proof, checkpointRoot); // true
```

## Proof packs

`GET /v1/contracts/{id}/proof` returns everything needed to audit a promise offline: the terms, their hashes, the verification report and the full signed journal (format `kept-proof-pack/v1`). Drop one on [/verify](/verify), or run:

```bash
npx @kept/mcp verify-proof proof-pack.json
```
