# Task Checklist: Wire Catalogue Products to Real Data

## Task 1: Add status field to product summary API
**Description:** Update `listCatalogueProductSummaries` in `src/lib/catalogue/repository.ts` to select and return the `status` field from `catalogueProducts` so the client can filter by draft/active/archived.

**Acceptance criteria:**
- [ ] The query selects `status` from `catalogueProducts`
- [ ] The returned type includes `status: string`
- [ ] Type exported for client use

**Verification:**
- [ ] Tests pass: `npm test src/lib/catalogue`
- [ ] Typecheck succeeds: `npm run typecheck`

**Dependencies:** None

**Files likely touched:**
- `src/lib/catalogue/repository.ts`

**Estimated scope:** Small: 1 file

---

## Task 2: Create types for client-side product data
**Description:** Define TypeScript types for the product list response and UI state (loading, error, data) to ensure type safety in the client component.

**Acceptance criteria:**
- [ ] Type matches API response shape (publicId, internalName, displayName, status)
- [ ] UI state types cover loading/error/success cases

**Verification:**
- [ ] Typecheck succeeds: `npm run typecheck`

**Dependencies:** Task 1

**Files likely touched:**
- New file or inline in component

**Estimated scope:** Small: 1 file

---

## Task 3: Create new client component that loads real product data
**Description:** Create `src/components/platform/catalogue-products-list.tsx` that fetches products from `/api/tenants/{tenantId}/catalogue/products`, handles loading/error/empty states, renders the table with real data, and navigates on row click. Reuse existing design-system components from the prototype.

**Acceptance criteria:**
- [ ] Component uses `staffApiFetch` to load products
- [ ] Shows loading spinner while fetching
- [ ] Shows error alert on API failure
- [ ] Shows empty state if no products
- [ ] Renders DataTable with real product rows
- [ ] Row click navigates to `/tenants/{tenantId}/catalogue/products/{publicId}/edit`
- [ ] New product button navigates to `/tenants/{tenantId}/catalogue/products/new`
- [ ] Count in title and pagination is computed from real data length
- [ ] Does NOT import from `@/mocks`

**Verification:**
- [ ] Typecheck succeeds: `npm run typecheck`
- [ ] No mock imports: `grep -r "from.*@/mocks" src/components/platform/catalogue-products-list.tsx` returns nothing

**Dependencies:** Task 1, Task 2

**Files likely touched:**
- `src/components/platform/catalogue-products-list.tsx` (new)

**Estimated scope:** Medium: 1 new file

---

## Task 4: Update catalogue hub page to pass tenantId to new component
**Description:** Change `src/app/tenants/[tenantId]/catalogue/page.tsx` to import and render the new component with `tenantId`, and render hub links (menus, modifier-groups, categories, import) so they remain accessible.

**Acceptance criteria:**
- [ ] Page extracts `tenantId` from params
- [ ] Page renders new component with `tenantId` prop
- [ ] Page includes links to menus, modifier-groups, categories, import pages
- [ ] Old `<CatalogueScreen />` import is removed

**Verification:**
- [ ] Typecheck succeeds: `npm run typecheck`
- [ ] Build succeeds: `npm run build`

**Dependencies:** Task 3

**Files likely touched:**
- `src/app/tenants/[tenantId]/catalogue/page.tsx`

**Estimated scope:** Small: 1 file

---

## Task 5: Implement search and tab filtering logic
**Description:** Add client-side filtering in the new component: tabs filter by status (all/draft/active/archived), search filters by displayName/internalName. Update tab counts and title count to reflect filtered results.

**Acceptance criteria:**
- [ ] Tabs filter products by status field
- [ ] Search input filters by product name (case-insensitive)
- [ ] Tab labels show real counts per status
- [ ] Title shows total product count
- [ ] Pagination total reflects filtered count
- [ ] Only tabs with backing status enum values are shown

**Verification:**
- [ ] Typecheck succeeds: `npm run typecheck`
- [ ] Manual test: search and tabs filter correctly

**Dependencies:** Task 3

**Files likely touched:**
- `src/components/platform/catalogue-products-list.tsx`

**Estimated scope:** Small: 1 file

---

## Task 6: Add redirect page for product URLs without /edit
**Description:** Create `src/app/tenants/[tenantId]/catalogue/products/[productPublicId]/page.tsx` that redirects to `./edit` using Next.js `redirect()`.

**Acceptance criteria:**
- [ ] Page extracts tenantId and productPublicId from params
- [ ] Page calls `redirect` to `/tenants/{tenantId}/catalogue/products/{productPublicId}/edit`
- [ ] Accessing `/catalogue/products/prd_...` redirects to `/catalogue/products/prd_.../edit`

**Verification:**
- [ ] Typecheck succeeds: `npm run typecheck`
- [ ] Build succeeds: `npm run build`
- [ ] Manual test: URL without /edit redirects

**Dependencies:** None

**Files likely touched:**
- `src/app/tenants/[tenantId]/catalogue/products/[productPublicId]/page.tsx` (new)

**Estimated scope:** Small: 1 file

---

## Task 7: Add tests for no mock imports, filtering, redirect
**Description:** Add or update tests to assert: (1) new component does not import from `@/mocks`, (2) filtering logic works, (3) redirect page redirects correctly. Check existing tests for breakage.

**Acceptance criteria:**
- [ ] Test asserts no imports from `@/mocks` in new component
- [ ] Test verifies search filtering
- [ ] Test verifies tab filtering by status
- [ ] Test verifies redirect page behavior
- [ ] All existing catalogue tests still pass

**Verification:**
- [ ] Tests pass: `npm test`

**Dependencies:** Task 3, Task 5, Task 6

**Files likely touched:**
- New test file or inline tests

**Estimated scope:** Small: 1-2 files

---

## Task 8: Run full test suite, lint, typecheck, and build
**Description:** Execute full project quality checks to ensure no regressions and all code meets standards.

**Acceptance criteria:**
- [ ] `npm test` passes with 0 failures
- [ ] `npm run lint` passes with 0 errors
- [ ] `npm run typecheck` passes with 0 errors
- [ ] `npm run build` completes successfully

**Verification:**
- [ ] All commands exit 0

**Dependencies:** Task 1-7

**Files likely touched:**
- All changed files

**Estimated scope:** Small: validation only
