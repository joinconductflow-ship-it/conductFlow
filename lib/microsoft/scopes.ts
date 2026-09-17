export const MICROSOFT_CAPABILITIES = {
  microsoft_365: {
    label: "Connect Outlook and Teams",
    detail: "Reads Outlook mail and Teams channels from clients you map, and can create Calendar events and Outlook drafts you approve. ConductFlow never sends anything on its own.",
    scopes: ["openid", "profile", "offline_access", "User.Read", "Mail.Read", "Mail.Send", "Calendars.ReadWrite", "Chat.Read", "ChannelMessage.Read.All", "Team.ReadBasic.All", "Channel.ReadBasic.All"],
  },
} as const;
