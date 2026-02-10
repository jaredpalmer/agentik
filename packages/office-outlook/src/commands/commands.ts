void Office.onReady(() => {
  // Ribbon command handlers placeholder
});

function showTaskpane(event: Office.AddinCommands.Event) {
  event.completed();
}

if (typeof Office !== "undefined") {
  Office.actions.associate("ShowTaskpane", showTaskpane);
}
