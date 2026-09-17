/**
 * Mail scopes are user-consentable in effectively every Microsoft 365 tenant: any employee
 * can grant them to themselves on the spot. Teams scopes are admin-consent-required in most
 * tenants — Microsoft drops any scope it can't grant from the issued token rather than
 * failing the whole sign-in, so a non-admin who clicks Connect gets a token with mail access
 * and silently no Teams access, no error shown. Splitting the groups lets the settings UI
 * tell those two outcomes apart instead of calling the whole connection broken.
 */
export const MICROSOFT_MAIL_SCOPES = ["Mail.Read", "Mail.Send", "Calendars.ReadWrite"] as const;
export const MICROSOFT_TEAMS_SCOPES = ["Chat.Read", "ChannelMessage.Read.All", "Team.ReadBasic.All", "Channel.ReadBasic.All"] as const;

export const MICROSOFT_CAPABILITIES = {
  microsoft_365: {
    label: "Connect Outlook and Teams",
    detail: "Reads Outlook mail and Teams channels from clients you map, and can create Calendar events and Outlook drafts you approve. ConductFlow never sends anything on its own.",
    scopes: ["openid", "profile", "offline_access", "User.Read", ...MICROSOFT_MAIL_SCOPES, ...MICROSOFT_TEAMS_SCOPES],
  },
} as const;
