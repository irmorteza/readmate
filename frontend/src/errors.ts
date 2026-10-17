export type ErrorKind = "offline" | "unauthorized" | "unreadable" | "busy" | "generic";

export class AppError extends Error {
  constructor(
    public readonly kind: ErrorKind,
    message?: string,
  ) {
    super(message ?? kind);
    this.name = "AppError";
  }
}
