import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthProvider.jsx";

vi.mock("../lib/supabase.js", () => ({ supabase: {} }));

afterEach(cleanup);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

function createAuthClient(getSessionResult) {
  const unsubscribe = vi.fn();
  let authChangeHandler;

  const client = {
    auth: {
      getSession: vi.fn(() => getSessionResult),
      onAuthStateChange: vi.fn((handler) => {
        authChangeHandler = handler;
        return { data: { subscription: { unsubscribe } } };
      }),
      signOut: vi.fn(),
    },
  };

  return {
    client,
    emitAuthChange: (...args) => authChangeHandler(...args),
    unsubscribe,
  };
}

function AuthState() {
  const { loading, session, user } = useAuth();

  if (loading) return <p>Loading authentication</p>;
  if (!session) return <p>Signed out</p>;
  return <p>{user.email}</p>;
}

describe("AuthProvider", () => {
  it("starts loading and resolves the initial session", async () => {
    const initialSession = deferred();
    const session = { user: { email: "wife@example.com" } };
    const { client } = createAuthClient(initialSession.promise);

    render(
      <AuthProvider client={client}>
        <AuthState />
      </AuthProvider>,
    );

    expect(screen.getByText("Loading authentication")).toBeInTheDocument();
    expect(client.auth.getSession).toHaveBeenCalledOnce();
    expect(client.auth.onAuthStateChange).toHaveBeenCalledOnce();

    await act(async () => {
      initialSession.resolve({ data: { session } });
      await initialSession.promise;
    });

    expect(await screen.findByText("wife@example.com")).toBeInTheDocument();
  });

  it("updates the session when authentication changes", async () => {
    const session = { user: { email: "wife@example.com" } };
    const auth = createAuthClient(Promise.resolve({ data: { session: null } }));

    render(
      <AuthProvider client={auth.client}>
        <AuthState />
      </AuthProvider>,
    );

    expect(await screen.findByText("Signed out")).toBeInTheDocument();

    act(() => auth.emitAuthChange("SIGNED_IN", session));

    expect(screen.getByText("wife@example.com")).toBeInTheDocument();
  });

  it("unsubscribes from authentication changes on cleanup", () => {
    const auth = createAuthClient(Promise.resolve({ data: { session: null } }));

    const { unmount } = render(
      <AuthProvider client={auth.client}>
        <AuthState />
      </AuthProvider>,
    );

    unmount();

    expect(auth.unsubscribe).toHaveBeenCalledOnce();
  });

  it("finishes loading safely when the initial session request fails", async () => {
    const auth = createAuthClient(Promise.reject(new Error("sensitive details")));

    render(
      <AuthProvider client={auth.client}>
        <AuthState />
      </AuthProvider>,
    );

    expect(await screen.findByText("Signed out")).toBeInTheDocument();
  });
});
