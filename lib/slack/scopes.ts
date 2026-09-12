export const SLACK_CAPABILITIES = {
  slack_watch: {
    label: "Watch Slack channels for new commitments",
    detail: "Map channels to clients. Messages become proposed commitments for you to review. Public channels are joined when mapped; invite the bot to private channels first.",
    scopes: ["channels:history", "channels:read", "groups:history", "groups:read", "users:read", "channels:join"],
  },
} as const;
