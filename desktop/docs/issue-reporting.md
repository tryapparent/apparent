# Text-only GitHub feedback

`apparent issue` lets an agent turn a bug or improvement into an issue in
`tryapparent/apparent`. It does not launch another agent, implement changes or merge.
This candidate is shared CLI code for macOS and Linux, not a GUI control.

## Enable and preview

The `issueReporting` experiment is off by default. Add
`"experiments": {"issueReporting": true}` to `~/.config/apparent/config.json`
while preserving all other keys, or pass `--experiment issueReporting` for one
invocation. CLI processes read the preference at invocation; no app restart is needed.

```sh
apparent issue --experiment issueReporting \
  --title 'Explain the zoom time syntax' \
  --body 'Show an example using minutes and seconds in zoom help.'
```

Without `--submit`, stdout contains only a JSON object with `repository`, `title`,
`body` and `submitted: false`. No GitHub command runs and no login is needed.
Use `--body-file './feedback draft.md'` instead of `--body` for multiline Markdown;
it must be a regular UTF-8 text file. Title and body are required and preserved
exactly; whitespace-only values are rejected. Titles have at most 256 characters,
without control characters. Bodies have at most 60000 bytes and cannot contain NUL.

## Submit only approved text

Search existing open and closed issues first, for example:

```sh
gh issue list --repo tryapparent/apparent --state all --search 'zoom time'
```

Show the human the exact repository, title and full description. Obtain explicit
approval before adding `--submit` to the same preview command. All issues are
public. Do not include private captures, transcripts, recordings, local paths,
credentials or personal data. No diagnostics, attachments, config values or
version metadata are collected automatically. This command does not assess or
redact arbitrary caller-supplied text. A title/body may be visible in local process
arguments while `gh` runs; do not supply secrets.

Install GitHub CLI (`gh`) and authenticate with
`gh auth login --hostname github.com`. The command always targets github.com and
the fixed repository, regardless of the current working directory. Authentication
and issue creation are noninteractive; missing access fails rather than prompting.
It never installs software, changes login or opens a browser automatically.

Each GitHub CLI call has a 30-second deadline, including output draining. Timeout
terminates that invocation's process group; stdout is limited to 512 KiB and
stderr is discarded without buffering. Successful submission reads the
exact issue back and checks its URL, title and body before printing JSON with
`submitted: true`, `repository`, `title`, `body`, `url` and `number`. Errors go to
stderr with a nonzero exit; parser errors exit 2, execution errors exit 1. Raw
GitHub CLI stderr is not echoed, to avoid exposing request data or credentials.

Submission is not idempotent. An interrupted request, error or failed readback
can leave an issue created. Check the returned URL (if available) or the repository
issue list before retrying; never blindly repeat `--submit`. No automatic retries.

## Verification

Run `cargo test --offline composition::issues::` for parser and input contracts.
Exercise the rebuilt executable with a synthetic `gh` on its child PATH for preview,
submission/readback, failure and mismatch checks. Do not create a public test issue.
A synthetic subprocess check proves CLI wiring, not live GitHub permissions.
