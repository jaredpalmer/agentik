export function watchMailboxItem(onItemChange: (subject: string | null) => void): () => void {
  const handler = () => {
    const item = Office.context.mailbox.item;
    onItemChange(item?.subject ?? null);
  };

  if (typeof Office !== "undefined" && Office.context?.mailbox) {
    Office.context.mailbox.addHandlerAsync(Office.EventType.ItemChanged, handler);
  }

  return () => {
    if (typeof Office !== "undefined" && Office.context?.mailbox) {
      Office.context.mailbox.removeHandlerAsync(Office.EventType.ItemChanged);
    }
  };
}
