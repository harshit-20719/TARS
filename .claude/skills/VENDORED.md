# Vendored: Compound Engineering skills

The `ce-*` and `lfg` skill directories in this folder are vendored from the
**Compound Engineering** plugin by Every.

| | |
|---|---|
| Source | https://github.com/EveryInc/compound-engineering-plugin |
| Version | 3.20.0 |
| Commit | `e6629187a1d0ff6118bc9b0a57d8ddd1d857ad5f` |
| Vendored on | 2026-07-24 |
| License | MIT © 2025 Every (full text below) |

## Why these live in the repo

Compound Engineering is normally installed as a Claude Code plugin
(`/plugin marketplace add EveryInc/compound-engineering-plugin`). Plugins are
stored per-machine and do **not** carry over to fresh cloud sessions or to a
different repo. Vendoring the skills into `.claude/skills/` makes them load
automatically for anyone who opens this repo — including web/cloud sessions —
with no plugin install step.

## How to use

Once loaded (a new session picks them up automatically), invoke via slash
commands: `/ce-brainstorm`, `/ce-plan`, `/ce-work`, `/ce-code-review`,
`/ce-compound`, etc. The core loop is **brainstorm → plan → work → review →
compound**. Workflow artifacts are written under `docs/` by default (the CE
"artifact root"); override via `.compound-engineering/config.yaml` with
`docs_root: <path>`.

Some skills bundle optional multi-model helper scripts (`scripts/*.py`,
`*.js`) that expect the plugin's TypeScript runtime and extra tooling. Those
are enhancements only; the skills fall back to single-host behavior when the
helpers aren't available, which is the case here.

## Updating

Re-clone the upstream repo at the desired tag and copy its top-level `skills/`
directory over `.claude/skills/`, then bump the Version/Commit above:

```
git clone --depth 1 https://github.com/EveryInc/compound-engineering-plugin /tmp/ce
cp -r /tmp/ce/skills/. .claude/skills/
```

---

## License (MIT)

```
MIT License

Copyright (c) 2025 Every

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
