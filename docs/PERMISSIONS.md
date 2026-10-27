# Permissions matrix (server-enforced)

Generated from `src/server/auth/permissions.ts` by `npx tsx scripts/write-permissions-doc.ts`. Every API route and page checks the permission on the server; menus are never authorization. Object-level customer scope is enforced separately in `src/server/auth/access.ts` (agents see only customers assigned, reserved or recently worked by them; team leads see their team; `customer.read.unscoped` roles see all; every denied access attempt is audited).

| Permission | Collection agent | Senior agent | Team lead | Collections head | Risk analyst | Model maker | Independent approver | Integration operator | Auditor / QA reviewer | System administrator | Service account |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `agent.desktop` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `agent.supervise` |  |  | ✓ | ✓ |  |  |  |  |  |  |  |
| `customer.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `customer.read.unscoped` |  |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `customer.contact.masked` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `queue.read` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `queue.claim` |  | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `queue.reassign` |  |  | ✓ | ✓ |  |  |  |  |  |  |  |
| `interaction.write` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `interaction.correct` |  | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `promise.write` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `callback.write` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `payment.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `payment.simulate` |  |  |  |  |  |  |  | ✓ |  | ✓ |  |
| `payment.reconcile` |  |  |  | ✓ |  |  |  | ✓ |  |  |  |
| `import.write` |  |  |  |  |  |  |  | ✓ |  | ✓ | ✓ |
| `strategy.read` |  |  | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ |  |
| `strategy.draft` |  |  |  | ✓ | ✓ |  |  |  |  |  |  |
| `model.read` |  |  | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ |  |
| `model.draft` |  |  |  |  |  | ✓ |  |  |  |  |  |
| `policy.draft` |  |  |  | ✓ | ✓ |  |  |  |  |  |  |
| `approval.request` |  |  | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |
| `approval.decide` |  |  |  |  |  |  | ✓ |  |  |  |  |
| `operations.read` |  |  | ✓ | ✓ | ✓ |  |  | ✓ | ✓ | ✓ |  |
| `operations.manage` |  |  | ✓ | ✓ |  |  |  |  |  |  |  |
| `analytics.read` |  |  | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ |  |
| `integration.read` |  |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `integration.operate` |  |  |  |  |  |  |  | ✓ |  | ✓ | ✓ |
| `exception.manage` |  |  | ✓ | ✓ |  |  |  | ✓ |  | ✓ |  |
| `audit.read` |  |  |  |  |  |  | ✓ |  | ✓ | ✓ |  |
| `settings.read` |  |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `settings.write` |  |  |  | ✓ |  |  |  |  |  | ✓ |  |
| `users.manage` |  |  |  |  |  |  |  |  |  | ✓ |  |
| `export.scoped` |  |  | ✓ | ✓ | ✓ |  |  |  | ✓ |  |  |
| `recovery.manage` |  |  | ✓ | ✓ |  |  |  |  |  |  |  |
| `arrangement.write` |  |  |  |  |  |  |  |  |  |  |  |
| `arrangement.review` |  |  | ✓ | ✓ |  |  |  |  |  |  |  |
| `campaign.manage` |  |  |  | ✓ |  |  |  |  |  |  |  |
| `template.manage` |  |  |  | ✓ |  |  |  |  |  |  |  |
| `support.restricted.read` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `demo.switch-role` |  |  |  |  |  |  |  |  |  | ✓ |  |

## Notes

- Maker/checker: `approval.request` creates requests; `approval.decide` decides them; the service refuses a checker who is also the maker even if a role held both.
- `demo.switch-role` exists only in DEMO mode for the admin identity and is audited.
- `support.restricted.read` grants access to restricted hardship details only to the owning reviewers (team lead / head); agents see a restriction flag, never the details.
- Service accounts (`svc.core-feed`) can only post integration events and imports.
