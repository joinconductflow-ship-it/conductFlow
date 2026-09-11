/**
 * Business decisions the legal pages need but this codebase cannot supply — shared so
 * Privacy and Terms stay in sync instead of drifting into two different placeholders.
 * Fill these in once they are actually decided. Do not invent a value here to make a
 * placeholder disappear: a policy that quietly ships with a fictional entity name or
 * retention period is worse than one that admits what has not been decided yet.
 */
export const LEGAL_PENDING = {
  /** The legal entity (or, pre-incorporation, the individual) that is party to the
   *  contract with the customer. Update once the business is formed. */
  entity: "[LEGAL ENTITY NAME — business not yet formed]",
  /** Where privacy and legal requests actually land. A real, monitored inbox. */
  contact: "joinconductflow@gmail.com",
  /** Governing jurisdiction, which decides which statutory rights and which court apply. */
  jurisdiction: "[JURISDICTION — to be set once the business is formed]",
  /** The date this text last changed. */
  updated: "[EFFECTIVE DATE — not yet published]",
  /**
   * How long a deleted org's rows survive before they are actually gone. There is no
   * retention/deletion job in the codebase yet, so any number written here today would be
   * a promise nothing keeps.
   */
  retention: "[RETENTION WINDOW — no automated deletion job exists yet]",
} as const;
