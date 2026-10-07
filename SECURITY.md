# Security

## Threat model

Localake is a **single-user, local-first** tool. It assumes the person using it
already has full access to the machine it runs on, and it is built to that
assumption:

- The server binds `127.0.0.1` and refuses any other address without
  `--allow-remote`.
- There is **no authentication**. Anyone who can reach the port is the user.
- The SQL editor gives DuckDB's full surface, which includes
  `read_csv('/any/path')` and `COPY … TO '/any/path'`. That is deliberate — it
  is how you query a file that sits outside the project — but it means the
  editor can read and write **any file the server process can reach**.
- One DuckDB instance is shared by every connected browser tab. Views created
  in one tab are visible in all of them, and result sets are addressable by
  their tab id.

In other words: **treat the Localake port exactly as you would a shell on that
machine.**

## Do not expose it on a network

Running Localake on a server and opening the port gives every visitor
unauthenticated read and write access to that server's filesystem, as the user
the process runs as. The CLI refuses to bind a non-loopback address for this
reason.

To use Localake on a remote machine, forward the port over SSH:

```bash
ssh -L 3000:127.0.0.1:3000 you@remote-machine
```

Authentication is then SSH's job, and Localake stays local to itself.

## Reducing the blast radius

Settings → **File access** → *Restrict to this project* sets DuckDB's
`enable_external_access=false`, which stops the editor reading paths outside
what the catalog already registered. DuckDB only allows tightening this within
a running process, so turning it back on requires a restart.

## What Localake never does

- No telemetry, no analytics, no crash reporting.
- No network calls at all in normal operation. The interface ships inside the
  package: no CDN, no webfonts, no remote Monaco.
- Nothing is written into your data directory except `.localake/`, which holds
  saved queries, charts, history, settings and DuckDB's spill files.

## Reporting a vulnerability

Open a GitHub issue for anything that contradicts the above. For an issue that
would put existing users at risk, use GitHub's private vulnerability reporting
rather than a public issue.
