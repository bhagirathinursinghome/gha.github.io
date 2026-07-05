# Fee Module — Database Structure & Due-Calculation Logic

Reference for the admission, fee-collection, and fee-due-report pages.
Full SQL: `sql/module_admission.sql` (student_master, fee_master) and
`sql/module_fee.sql` (fee_categories, fee_receipts, reactivated_at).

## 1. `student_master`

One row per student. `reg_no` is the primary key (user-entered, not a uuid).

| Column            | Type        | Notes |
|-------------------|-------------|-------|
| `reg_no`          | text, PK    | Registration number, entered by user |
| `name`             | text        | Student name |
| `father_name`      | text        | Father's name |
| `mobile_no`        | text        | Contact number |
| `class`             | text        | One of: `4,5,6,7,8,9,10,11-arts,11-science,12-arts,12-science` |
| `admission_date`    | date        | Original admission date |
| `status`             | text        | `active` \| `deactivated` |
| `is_readmission`     | boolean     | `true` once the student has been readmitted at least once |
| `remark`              | text        | Optional |
| `recorded_by`         | uuid → auth.users | Who created the record |
| `recorded_at`          | timestamptz | When it was created |
| `deactivate_date`       | date        | Date set inactive (null if active) |
| `deactivated_by`         | uuid → auth.users | Who deactivated |
| `deactivated_at`          | timestamptz | When deactivated |
| `updated_by`                | uuid → auth.users | Last editor |
| `updated_at`                 | timestamptz | Last edit time |
| `reactivated_at`              | date | Set when a **deactivated** student is readmitted. Marks where the new active period starts, so a deactivated gap is never charged fees for. Null if the student has never had a deactivation-then-readmission cycle. |

## 2. `fee_master` — fee **history**, not a payments/receipts table

One row per fee-amount **event** for a student. This table only records
*what the fee amount is/was at a point in time* — it does not track
whether that amount has actually been paid. That's what `fee_receipts`
(below) is for.

| Column            | Type        | Notes |
|-------------------|-------------|-------|
| `fee_id`           | uuid, PK    | |
| `student_reg_no`    | text → student_master.reg_no (cascade delete) | |
| `type`               | text        | `admission` \| `readmission` \| `monthly` |
| `amount`              | numeric(10,2) | The fee amount for this event |
| `remark`               | text        | Optional |
| `recorded_by`           | uuid → auth.users | |
| `recorded_at`            | timestamptz | Event/effective timestamp |

**Rows are never updated or deleted** — corrections are made by inserting
a new row. This preserves full history for auditing and for recalculating
old dues correctly.

### How rows get created
- **New admission** → 2 rows: one `admission` (the admission fee charged
  once) and one `monthly` (the monthly fee effective from that date).
- **Readmission** → 2 rows: one `readmission` (the readmission fee charged
  once) and one `monthly` (the *new* monthly fee effective from that date,
  since readmission is when monthly fee is most commonly revised).

### How this feeds the actual due calculation
See section 5 below for the exact, implemented algorithm. In short: the
latest `monthly` row's amount is used as the rate for any month from its
`recorded_at` onward, and every `admission`/`readmission` row is a
one-time charge that adds up against `fee_receipts` payments of that type.

### Example query — latest monthly fee per active student
```sql
select distinct on (student_reg_no) student_reg_no, amount as monthly_fee, recorded_at
from public.fee_master
where type = 'monthly'
order by student_reg_no, recorded_at desc;
```

## 3. `fee_categories` — user-defined categories for "Other" fees

| Column | Type | Notes |
|---|---|---|
| `category_id` | uuid, PK | |
| `name` | text, unique | e.g. "Transport Fee", "Exam Fee" |
| `active` | boolean | |
| `created_by` / `created_at` | uuid / timestamptz | |

Created on the fly from the "+ New" button in the Other Fee tab, or
auto-created during bulk upload if the category name doesn't exist yet.

## 4. `fee_receipts` — every payment actually received

One row per payment transaction, of any of the three collection types.

| Column | Type | Notes |
|---|---|---|
| `receipt_id` | uuid, PK | |
| `student_reg_no` | text → student_master.reg_no (cascade delete) | |
| `fee_type` | text | `monthly` \| `admission_readmission` \| `other` |
| `for_months` | text[] | e.g. `{2026-05,2026-06}` — **informational only**, monthly type only |
| `category_id` | uuid → fee_categories | other type only |
| `amount_cash` / `amount_bank` / `amount_phonepe` | numeric | split across payment modes; a single payment can mix modes |
| `discount` | numeric | reduces due the same way a payment does |
| `remark` | text | |
| `recorded_by` / `recorded_at` | uuid / timestamptz | |

`for_months` is just a label for reports — it does **not** determine which
month actually gets marked paid. See the algorithm below for why.

## 5. Due-calculation algorithm (as implemented)

### Monthly fee
1. **Active window**: from `reactivated_at` (if set) or `admission_date`,
   to `deactivate_date` (if deactivated) or today — whichever is earlier.
2. **Rate per month**: the latest `fee_master` row of type `monthly` whose
   `recorded_at` is on/before the end of that month (rates can change
   mid-course; each month uses whatever rate was in effect then).
3. **Payments pool**: sum of `amount_cash + amount_bank + amount_phonepe +
   discount` across *all* `monthly` receipts for the student — discount
   counts the same as a payment.
4. **FIFO allocation**: walk the active months oldest → newest, subtracting
   each month's rate from the pool. A month is `paid` if the pool fully
   covers it, `partial` if the pool covers less than the rate (remaining
   pool becomes that month's payment, the rest is due), or `due` if the
   pool is already exhausted.
5. **Total due** = sum of the `due`/`partial` amounts across the *entire*
   active window (not just the months shown on screen).
6. **Displayed grid**: shows the union of two sets of months — the
   student's class session window (Class 4–9: Jan–Dec of the current
   calendar year; Class 10: Jan–Mar; Class 11/12: April–March, whichever
   such window contains today) **and** every month the student has
   actually been active for. This union matters for a student who's still
   active past their class's nominal window (e.g. a Class 10 student still
   enrolled in July) — those extra months are added to the grid instead of
   being dropped. Every displayed month is one of: `paid`, `partial` (due
   shown), `due` (full rate shown), or `inactive` — a month is `inactive`
   whenever it falls before the student's admission/reactivation month, or
   after today (or after deactivation), with no separate "N/A" category.
   Because the grid always includes every month with real due, the Total
   Due figure shown always matches the sum of what's visible on screen —
   nothing is ever hidden in an "off-grid" total.

### Admission / Readmission fee
`due = (sum of all fee_master rows where type is 'admission' or
'readmission') − (sum of amount_cash+amount_bank+amount_phonepe+discount
across all admission_readmission receipts)`. Every readmission adds a new
one-time charge on top of prior ones, so this naturally accumulates if a
student is readmitted more than once without clearing a prior charge.

### Other fee
No due tracking — it's a plain ad-hoc receipt log against a category,
with no corresponding "charge" to compare against.

## 7. Permissions
Same full-access / limited-access split as every other module:
- **Limited access** (e.g. `viewer`): can search students and record new
  payments (monthly/admission-readmission/other), and view all reports.
  Cannot edit or delete an existing payment once saved.
- **Full access** (`admin`/`editor`): everything limited access can do,
  plus editing or deleting any existing `fee_receipts` row (Edit/Delete
  buttons appear in the payment history tables on the Fee Collection page).
  Enforced both in the UI (buttons hidden for limited access) and at the
  database level via the `fee_receipts_update`/`fee_receipts_delete` RLS
  policies in `sql/module_fee.sql`.
- Deleting or editing a payment immediately changes the FIFO pool, so due
  amounts recalculate the next time the student is looked up — there's no
  separate "recalculate" step needed.
- The Fee Due & Reports page is read-only for both access levels by
  design — corrections happen on the Fee Collection page, where the
  record naturally lives.

## 8. Where this is implemented
- `pages/fee-collection.html` — the calculation engine + collection UI
  (search student → Monthly / Admission-Readmission / Other tabs, plus
  bulk Excel upload for each type).
- `pages/fee-due-report.html` — the same calculation engine reused
  read-only, plus class-wise, month-wise, and date-range aggregate
  reports.
- Both pages **duplicate** the calculation functions rather than sharing
  a file, consistent with this project's "every page is a standalone
  module" convention (see HOW_TO_ADD_PAGE.md). If you change the due
  formula, update it in both files.
