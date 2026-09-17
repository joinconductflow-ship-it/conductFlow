-- Serialize concurrent popup logins without restricting manually labeled tokens.
create unique index desktop_token_org_user_extension_idx
  on desktop_token (org_id, user_id)
  where label = 'Chrome extension (auto)' and revoked_at is null;
