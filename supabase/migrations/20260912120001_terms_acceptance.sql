-- Existing accounts have no recorded acceptance; do not infer or backfill consent.
-- Bootstrap explicitly supplies the acceptance time for new accounts.
alter table app_user
  add column terms_accepted_at timestamptz;
