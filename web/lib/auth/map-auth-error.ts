type SignupField = "business" | "email" | "password";

export function mapSignupError(message: string): {
  field: SignupField;
  text: string;
} {
  const m = message.toLowerCase();
  if (
    m.includes("already been registered") ||
    m.includes("already registered") ||
    m.includes("user already")
  ) {
    return {
      field: "email",
      text: "An account with this email already exists.",
    };
  }
  if (
    m.includes("password") &&
    (m.includes("6") || m.includes("least") || m.includes("short"))
  ) {
    return {
      field: "password",
      text: "Password must be at least 6 characters.",
    };
  }
  if (m.includes("email") && (m.includes("invalid") || m.includes("format"))) {
    return { field: "email", text: "Enter a valid email address." };
  }
  return {
    field: "email",
    text: message || "Something went wrong. Try again.",
  };
}

export function mapLoginError(message: string): string {
  const m = message.toLowerCase();
  if (
    m.includes("invalid login") ||
    m.includes("invalid credentials") ||
    m.includes("email not confirmed")
  ) {
    return "Invalid email or password.";
  }
  return message || "Could not sign in. Try again.";
}
