## What this changes

<!-- And why. If it fixes an issue, "Fixes #123". -->

## How you verified it

<!-- What you ran, what you clicked, what you checked. -->

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passes
- [ ] Screenshots below, in both themes, if this changes the interface

## Checklist

- [ ] No secret-key handling, transaction signing, or submission was added
- [ ] Money stays a decimal string — no `number` in a monetary path
- [ ] No totals across different assets
- [ ] No released migration was edited; new schema changes are a new file
- [ ] No account history was committed to `tests/fixtures/`
- [ ] Keyboard reachable, with a visible focus ring, if interactive
- [ ] No `Co-Authored-By` or generated attribution trailers in the commits
