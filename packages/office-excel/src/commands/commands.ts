/**
 * Ribbon button command handlers.
 * These are placeholder implementations for future ribbon integration.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

function showTaskpane(event: Office.AddinCommands.Event): void {
  // Placeholder: show the taskpane when the ribbon button is clicked
  event.completed();
}

// Register command handlers with Office
void Office.onReady(() => {
  // Commands are registered via the manifest and resolved by function name.
  // Office looks for globally-registered functions.
  (globalThis as Record<string, unknown>).showTaskpane = showTaskpane;
});
