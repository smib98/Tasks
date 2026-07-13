const baseUrl = process.env.NOTETASKS_URL ?? "http://127.0.0.1:3000";

async function check(path: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json();
}

async function main() {
  const health = await check("/api/health");
  if (!health.ok) {
    throw new Error("Health check did not return ok.");
  }

  const tasks = await check("/api/tasks");
  if (!Array.isArray(tasks.tasks)) {
    throw new Error("Tasks API did not return a tasks array.");
  }

  console.log(`API checks passed against ${baseUrl}. Tasks returned: ${tasks.tasks.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
