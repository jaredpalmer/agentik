export function watchSlideSelection(onSelectionChange: (slideIndex: number) => void): () => void {
  const handler = () => {
    try {
      void PowerPoint.run(async (context) => {
        const slides = context.presentation.slides;
        slides.load("items");
        await context.sync();
        // PowerPoint JS API has limited selection events
        // This is a placeholder for future selection tracking
        onSelectionChange(0);
      });
    } catch {
      // Ignore errors during context tracking
    }
  };

  if (typeof Office !== "undefined" && Office.context?.document) {
    Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, handler);
  }

  return () => {
    if (typeof Office !== "undefined" && Office.context?.document) {
      Office.context.document.removeHandlerAsync(Office.EventType.DocumentSelectionChanged, {
        handler,
      });
    }
  };
}
