# Implementation Plan: Wire Catalogue Products to Real Data

## Overview
Transform the Catalogue > Products screen from prototype mock data to real tenant-scoped data loaded from the existing API. The screen was changed to use `<CatalogueScreen />` with fixed mock data in commit 91be572. We need to load real products, enable filtering by status/search, make row clicks navigate to the edit page, and add a redirect page for product URLs without /edit.

## Architecture Decisions
- **Client-side data fetching**: Follow existing staff page patterns using `staffApiFetch` in a client component with loading/error states
- **API enhancement**: Add `status` field to `listCatalogueProductSummaries` return type so tabs can filter by draft/active/archived
- **Client-side filtering**: Search and tab filtering will be handled client-side; server query params only if API already supports them (scope check: API does not currently accept filters)
- **Navigation**: Row clicks use Next.js navigation to `/tenants/{tenantId}/catalogue/products/{publicId}/edit`
- **Redirect page**: New page at `/catalogue/products/[productPublicId]/page.tsx` redirects to `./edit` using Next.js redirect
- **Keep existing routes**: The hub page still links to menus, modifier-groups, categories, import so they remain accessible

## Task List

### Phase 1: API and Type Updates
- [ ] Task 1: Add status field to product summary API
- [ ] Task 2: Create types for client-side product data

### Phase 2: Client Component Implementation
- [ ] Task 3: Create new client component that loads real product data
- [ ] Task 4: Update catalogue hub page to pass tenantId to new component
- [ ] Task 5: Implement search and tab filtering logic
- [ ] Task 6: Add redirect page for product URLs without /edit

### Checkpoint: Core Functionality
- [ ] Products load from API
- [ ] Search and tabs filter correctly
- [ ] Row clicks navigate to edit page
- [ ] Redirect page works

### Phase 3: Testing and Verification
- [ ] Task 7: Add tests for no mock imports, filtering, redirect
- [ ] Task 8: Run full test suite, lint, typecheck, and build

### Checkpoint: Complete
- [ ] All tests pass
- [ ] Lint and typecheck clean
- [ ] Build succeeds
- [ ] Manual QA passes with staff.demo/tenant 0fe2c09b

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing tests | Medium | Check all test files, update assertions that depend on mock structure |
| Status field mismatch | Low | Verify database enum matches tab filter logic (draft/active/archived) |
| Navigation breaks other pages | Low | Keep all existing hub links intact; only change Products section |

## Open Questions
None - all requirements are specified.
