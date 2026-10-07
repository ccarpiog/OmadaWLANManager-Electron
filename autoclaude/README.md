# autoclaude inbox

Drop a short markdown or text file into `inbox/` to propose work for the
autoclaude loop running on this project. Anyone may: a person, another LLM.

- One idea per file, under 16 KiB. A big plan goes elsewhere (for example
  `pending/`) with a short note here pointing at it.
- The loop reads the inbox at the start of each iteration and again at every
  phase boundary, so pickup takes until the next phase boundary — typically
  well under an hour — and never happens mid-phase.
- It takes at most three items at a time, **in alphabetical order by
  filename** — not oldest first — with accents and case sorted the way you
  would expect, so `añadir` falls between `alpha` and `Árbol`. The name is
  therefore how you set priority: a dated prefix like
  `2026-09-03-cache-report.md` keeps the queue chronological, and a numeric one
  like `10-`, `20-`, `30-` orders it by hand. A name late in the alphabet waits
  while earlier ones keep arriving, so avoid `zzz-` for anything you actually
  want done.
- A file is picked up once it has been unchanged for two minutes. Name it
  `something.part` while composing and rename when done if you want certainty.
- Rewriting a file the loop has already picked up voids that pickup: the copy it
  was holding comes back here untouched, and if you have since dropped a new
  file under the same name the returned one arrives beside it with the epoch in
  its name — `notes.released-1758300000.md` for a `notes.md`. Both are then
  offered as ordinary items, so delete the one you did not mean.
- An item is a proposal, not an order. It is queued as a phase after the plan's
  remaining work, or deferred with a reason. A first line `priority: next`
  asks for it to follow the current phase.
- What happened to each item is one line in `processed/LOG.md`. **The file
  itself moves to `processed/`, unchanged, and is then committed and pushed
  with the rest of the project — including when it was deferred.** Do not put
  anything here you would not put in the repository: no credentials, no private
  URLs, no personal data about anyone.
- This directory is a trust boundary: whoever can write here shapes what an
  unattended, permission-bypassed session builds — the same power as write
  access to the project itself. Share it accordingly.
