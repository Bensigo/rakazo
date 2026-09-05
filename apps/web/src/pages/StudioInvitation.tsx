import { Button } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { authClient } from "../lib/auth";
import { clearSpaceSelection } from "../lib/rpc";
import {
  acceptStudioInvitation,
  getStudioInvitation,
  type StudioInvitation,
} from "../lib/studio-invitations";

export function StudioInvitationPage({ signedIn }: { signedIn: boolean }) {
  const { invitationId = "" } = useParams();
  const location = useLocation();
  const [invitation, setInvitation] = useState<StudioInvitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const next = `${location.pathname}${location.search}`;
  const nextQuery = `?next=${encodeURIComponent(next)}`;

  useEffect(() => {
    if (!signedIn || !invitationId) return;
    let active = true;
    void getStudioInvitation(invitationId)
      .then((value) => {
        if (active) setInvitation(value);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Invitation unavailable");
      });
    return () => {
      active = false;
    };
  }, [invitationId, signedIn]);

  async function accept() {
    if (!invitationId || pending) return;
    setPending(true);
    setError(null);
    try {
      await acceptStudioInvitation(invitationId);
      clearSpaceSelection();
      window.location.assign("/studio");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not accept invitation");
      setPending(false);
    }
  }

  async function signOut() {
    await authClient.signOut();
    window.location.assign(`/sign-in${nextQuery}`);
  }

  return (
    <main className="grid min-h-full place-items-center bg-background px-6 py-12">
      <section className="w-full max-w-lg rounded-3xl border border-border bg-card p-8 shadow-sm">
        <p className="text-sm text-muted-foreground">Sunrise Studio</p>
        <h1 className="mt-2 text-2xl font-semibold">Join your studio</h1>
        {!signedIn ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              Sign in or create an account with the invited email address to review this invitation.
            </p>
            <div className="mt-6 flex gap-3">
              <Button onClick={() => window.location.assign(`/sign-in${nextQuery}`)}>
                Sign in
              </Button>
              <Button
                variant="secondary"
                onClick={() => window.location.assign(`/sign-up${nextQuery}`)}
              >
                Create account
              </Button>
            </div>
          </>
        ) : invitation ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              <strong className="text-foreground">{invitation.organizationName}</strong> invited{" "}
              {invitation.email} as an employee. You will enter its shared workspace; your existing
              personal and private spaces stay separate.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Expires {new Date(invitation.expiresAt).toLocaleString()}
            </p>
            <Button className="mt-6" disabled={pending} onClick={() => void accept()}>
              {pending ? "Joining…" : "Accept invitation"}
            </Button>
          </>
        ) : error ? (
          <>
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              The invitation may be expired, already used, or addressed to another account.
            </p>
            <Button className="mt-6" variant="secondary" onClick={() => void signOut()}>
              Sign in with another account
            </Button>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Checking invitation…</p>
        )}
      </section>
    </main>
  );
}
