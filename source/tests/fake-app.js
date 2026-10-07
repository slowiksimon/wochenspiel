// Test double for 'firebase/app' (used by `FAKE=1 node build.mjs`).
export function initializeApp(options, name) {
  if (options && options.projectId === 'boom-test-1') throw new Error('simulated: the SDK refuses this configuration');
  return { name: name || '[DEFAULT]', options: options || {}, __fake: true, deleted: false };
}
export async function deleteApp(app) { app.deleted = true; }
