/** Refuses to run destructive test setup against anything but a local *_test database. */
export function assertSafeTestDatabase(connectionString: string): void {
  const url = new URL(connectionString);
  const local = ["localhost", "127.0.0.1", "::1", "[::1]", "postgres"].includes(url.hostname);
  const name = url.pathname.replace(/^\//, "");
  if (!local || !name.endsWith("_test")) {
    throw new Error(`Refusing to reset database "${name}" on host "${url.hostname}". Use a local *_test database.`);
  }
}
