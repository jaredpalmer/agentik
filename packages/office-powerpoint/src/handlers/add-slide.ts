import type { TextContent } from "@agentik/office-common";

export async function handleAddSlide(params: {
  layout?: string;
  insertAt?: number;
  title?: string;
  body?: string;
}): Promise<{ content: TextContent[]; isError: boolean }> {
  try {
    const result = await PowerPoint.run(async (context) => {
      context.presentation.slides.add();
      await context.sync();

      context.presentation.slides.load("items");
      await context.sync();
      const newSlide =
        context.presentation.slides.items[context.presentation.slides.items.length - 1];

      if (params.title || params.body) {
        newSlide.shapes.load("items");
        await context.sync();
        for (const shape of newSlide.shapes.items) {
          shape.load("name");
          if (shape.textFrame) shape.textFrame.load("textRange");
          await context.sync();
          if (params.title && shape.name.toLowerCase().includes("title") && shape.textFrame) {
            shape.textFrame.textRange.text = params.title;
          } else if (
            params.body &&
            shape.name.toLowerCase().includes("content") &&
            shape.textFrame
          ) {
            shape.textFrame.textRange.text = params.body;
          }
        }
        await context.sync();
      }
      return `Added slide ${context.presentation.slides.items.length}`;
    });
    return { content: [{ type: "text", text: result }], isError: false };
  } catch (err) {
    return {
      content: [
        { type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ],
      isError: true,
    };
  }
}
