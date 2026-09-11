-- Discard on a commitment recorded an approval_event but never moved commitment.status,
-- so a discarded item stayed "proposed" and kept reappearing in the review queue forever.
-- Add 'rejected' as a real status so rejectCommitment() can actually remove it from view.
alter table commitment drop constraint commitment_status_check;
alter table commitment add constraint commitment_status_check
  check (status in ('proposed','approved','tasked','done','overdue','rejected'));
