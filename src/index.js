// strategy-referee — entry point.
// Implementation arrives in subsequent commits; this skeleton is the bootstrap.

export const VERSION = "0.0.1";

export function placeholder() {
  return { ready: false, message: "skeleton — implementation pending" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(placeholder(), null, 2));
}
