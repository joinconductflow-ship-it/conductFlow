import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/db/queries";
import { readPageData } from "@/lib/db/page-read";
import { Unavailable } from "@/components/ui/Unavailable";
import { AppNav } from "@/components/nav/AppNav";

/** Reading the session needs cookies, so this group never prerenders. */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await readPageData("app layout: navigation auth", () => getCurrentUser("app layout"));
  const email = user.data?.email ?? null;

  /*
   * The gate for every page in this group. Signed out, these routes used to render a
   * logged-out shell: /queue answered 200 with an empty list and a "sign in" prompt, which
   * reads as "you have no work" rather than "you are not signed in". Sending people to the
   * login instead means the first screen is always the one that can actually help them.
   *
   * Each page and server action still verifies access on its own. This redirect is the
   * front door, not the lock: it decides what an anonymous visitor sees, and is not what
   * keeps one workspace's data out of another's.
   *
   * /onboarding deliberately lives outside this group, in (auth), so that the redirect
   * target is not itself behind the redirect.
   *
   * `unavailable` is the case where the session lookup itself failed rather than returning
   * "nobody". Redirecting there would bounce a signed-in user to the login on a transient
   * database error, so the shell renders with a notice and lets the page speak for itself.
   */
  if (!email) {
    if (user.unavailable) {
      return <><Unavailable section="Account navigation is" />{children}</>;
    }
    redirect("/onboarding");
  }

  return (
    <>
      {/* Off-screen until it is focused, which is the whole point: a keyboard user should
          not have to tab through five destinations to reach the queue. */}
      <a href="#main" className="skip-link">Skip to content</a>
      <AppNav email={email} />
      {/* The pages own their <main>; this wrapper is the skip link's target, and takes
          tabIndex so the browser will actually move focus into it. */}
      <div id="main" tabIndex={-1} style={{ outline: "none" }}>{children}</div>
    </>
  );
}
