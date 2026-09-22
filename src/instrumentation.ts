export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { start } = await import('./lib/scheduler');
    start();
  }
}
