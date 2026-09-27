# Incident reports

One file per incident, named `YYYY-MM-DD-short-name.md`, written within a week (docs/RUNBOOKS.md, "Suspected
security incident"; backend spec 24.5). Blameless: describe what the system and the process allowed, not who
typed what. Never include secrets, device IDs, push endpoints, names or phone numbers.

## Template

```markdown
# <date>: <one-line summary>

- **Impact:** who was affected, for how long, and what they saw ("Not confirmed yet", delays, nothing).
- **Personal data:** affected or not; if affected, when the Data Protection Board and the people were told (17.2).
- **Detection:** which alert, check or person noticed it, and when.

## Timeline (IST)

- hh:mm what happened / what was done

## Cause

What failed, and why the existing tests and alerts did not catch it earlier.

## Fix

- The change, and the test that now reproduces the problem (link to the test).
- Follow-ups, each with an owner.
```
