import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginScreen } from "./LoginScreen.jsx";

vi.mock("../lib/supabase.js", () => ({ supabase: {} }));

afterEach(cleanup);

function createClient(signInWithOtp) {
  return { auth: { signInWithOtp } };
}

describe("LoginScreen", () => {
  it("emails a private sign-in link to the trimmed address", async () => {
    const user = userEvent.setup();
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });

    render(<LoginScreen client={createClient(signInWithOtp)} />);

    await user.type(screen.getByLabelText("E-post"), "  wife@example.com  ");
    await user.click(screen.getByRole("button", { name: "Skicka inloggningslänk" }));

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "wife@example.com",
      options: {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: false,
      },
    });
    expect(
      await screen.findByText("Kolla din e-post för inloggningslänken."),
    ).toBeInTheDocument();
  });

  it("shows the returned safe message and allows another attempt after failure", async () => {
    const user = userEvent.setup();
    const signInWithOtp = vi.fn().mockResolvedValue({
      error: { message: "This email address is not invited." },
    });

    render(<LoginScreen client={createClient(signInWithOtp)} />);

    await user.type(screen.getByLabelText("E-post"), "wife@example.com");
    const submitButton = screen.getByRole("button", { name: "Skicka inloggningslänk" });
    await user.click(submitButton);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This email address is not invited.",
    );
    expect(submitButton).toBeEnabled();
  });

  it("disables submission while a sign-in request is pending", async () => {
    const user = userEvent.setup();
    const signInWithOtp = vi.fn(() => new Promise(() => {}));

    render(<LoginScreen client={createClient(signInWithOtp)} />);

    await user.type(screen.getByLabelText("E-post"), "wife@example.com");
    const submitButton = screen.getByRole("button", { name: "Skicka inloggningslänk" });
    await user.click(submitButton);

    expect(submitButton).toBeDisabled();
    expect(signInWithOtp).toHaveBeenCalledOnce();
  });
});
