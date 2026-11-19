# Connect CLI reader profiles

On the machine and OS account that runs the agent, create one named reader
per sender account. Have each sender open their own verification link and
approve the read grant while signed in to the Connect account they upload from.

```sh
apparent connect login --server https://hosted.tryapparent.com --reader sender-one --no-browser
apparent connect login --server https://hosted.tryapparent.com --reader sender-two --no-browser
apparent connect readers
apparent inspect <capture-id>
```

`inspect`, `fetch` and `connect files` look up bare capture IDs using the default
reader and the named readers approved on the configured API origin (or
`https://hosted.tryapparent.com` if no origin is configured). Use `--reader <name>`
to select a specific identity, including a reader approved on a different origin.
`--reader default` selects the existing unnamed reader explicitly. If two
profiles are approved under the same account, use the one that was approved
when the capture was encrypted. Adding a profile does not grant access to old
ciphertext that did not include its public key.

Each named reader keeps its own read credential, renewal state and endpoint keys
under `hosted/readers/<name>/`. Upload consent and the default reader stay in
place. `apparent connect logout
--reader <name>` signs out that profile. An unqualified logout signs out the
original default credentials. A shared agent runtime can access every reader
profile available to its OS account.
