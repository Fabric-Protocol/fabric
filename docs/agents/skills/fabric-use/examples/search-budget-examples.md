# Search Budget Examples

## Good pattern

- choose the right scope
- set the smallest useful filter set
- set `budget.credits_requested` to a real ceiling
- inspect the response before broadening

## If Fabric returns `402 budget_cap_exceeded`

Do one of these:
- increase `budget.credits_requested`
- narrow the search
- switch to a more targeted browse path

Do not treat this as a successful search with capped results.

## If Fabric returns `402 credits_exhausted`

Do one of these:
- purchase credits
- stop and defer
- change strategy so you do not repeat the same failing metered action
